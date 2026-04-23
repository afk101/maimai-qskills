#!/usr/bin/env node
// batch-communicate.mjs — 脉脉批量勾选+沟通候选人
// 用法: node batch-communicate.mjs <target> [--score-min N] [--message "消息内容"]
//
// 流程: 1. read-candidates 读取候选人  2. JD匹配打分
//       3. 勾选匹配的候选人  4. 点击头部"立即沟通"批量发送

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CDP = path.resolve(__dirname, '../../chrome-cdp/scripts/cdp.mjs');
const READ_SCRIPT = path.resolve(__dirname, 'read-candidates.mjs');

const args = process.argv.slice(2);
const target = args[0];
if (!target) { console.log('用法: node batch-communicate.mjs <target> [--score-min N] [--message "消息"]'); process.exit(1); }

// ── 解析参数 ──
let scoreMin = 2;
let message = ''; // 不设默认值，必须由调用方通过 --message 传入
let dryRun = args.includes('--dry-run');
let keywordsArg = '';

const si = args.indexOf('--score-min');
if (si !== -1 && args[si + 1]) scoreMin = parseInt(args[si + 1]) || 2;
const mi = args.indexOf('--message');
if (mi !== -1 && args[mi + 1]) message = args[mi + 1];
const ki = args.indexOf('--keywords');
if (ki !== -1 && args[ki + 1]) keywordsArg = args[ki + 1];

// 关键词从参数解析（逗号分隔），不写死
const jdKeywords = keywordsArg
  ? keywordsArg.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
  : [];

if (!message) { console.log('❌ 缺少 --message 参数，请传入沟通文案'); process.exit(1); }

console.log('📊 最低匹配分: ' + scoreMin);
console.log('💬 消息: ' + message);
console.log('🔑 关键词: ' + (jdKeywords.length ? jdKeywords.join(', ') : '（未指定，所有候选人均 0 分）'));
if (dryRun) console.log('🔇 DRY RUN — 只勾选不发送\n');
else console.log('');

// ── CDP helpers ──

let _tc = 0;
function ev(js) {
  _tc++;
  const tmp = '/tmp/_bc_' + process.pid + '_' + _tc + '.js';
  fs.writeFileSync(tmp, js);
  try {
    return execSync('node ' + JSON.stringify(CDP) + ' eval ' + target + ' @' + tmp, {
      timeout: 12000, encoding: 'utf8', stderr: 'pipe'
    }).trim();
  } finally { try { fs.unlinkSync(tmp); } catch {} }
}

function click(selector) {
  return execSync('node ' + JSON.stringify(CDP) + ' click ' + target + ' ' + JSON.stringify(selector), {
    timeout: 10000, encoding: 'utf8', stderr: 'pipe'
  }).trim();
}

function sleep(ms) {
  execSync('sleep ' + Math.max(1, Math.round(ms / 1000)), { timeout: Math.round(ms / 1000) + 3000 });
}

// ── Step 1: 读取候选人 ──

console.log('📋 读取候选人列表...');
const candidatesFile = '/tmp/maimai-candidates_batch_' + Date.now() + '.json';
try {
  execSync('node ' + JSON.stringify(READ_SCRIPT) + ' ' + target + ' ' + candidatesFile, {
    timeout: 20000, encoding: 'utf8', stderr: 'pipe'
  });
} catch (e) {
  console.log('❌ 读取失败: ' + e.stderr.substring(0, 200));
  process.exit(1);
}

const candidates = JSON.parse(fs.readFileSync(candidatesFile, 'utf8'));
const contactable = candidates.filter(c => c.canContact);
console.log('   共 ' + candidates.length + ' 人, 可沟通 ' + contactable.length + ' 人\n');

// ── Step 2: JD 匹配打分 ──

function scoreCandidate(info) {
  const text = info.toLowerCase();
  let score = 0, matches = [];
  for (const kw of jdKeywords) {
    if (text.includes(kw)) { score++; matches.push(kw); }
  }
  return { score, matches };
}

const scored = contactable.map(c => ({ ...c, ...scoreCandidate(c.info) })).sort((a, b) => b.score - a.score);
const selected = scored.filter(c => c.score >= scoreMin);

console.log('🎯 匹配 ≥' + scoreMin + ' 分: ' + selected.length + ' 人');
for (const s of selected) {
  console.log('   ' + s.score + '分 ' + s.name.padEnd(14) + ' [' + s.matches.join(', ') + ']');
}
console.log('');

if (selected.length === 0) {
  console.log('没有符合条件的候选人'); process.exit(0);
}

// ── Step 3: 勾选候选人 ──

console.log('☑️ 勾选 ' + selected.length + ' 位候选人...');
let checkOk = 0;

for (const c of selected) {
  const r = ev('(function(){var inner=document.querySelector(".talentContent___2d5ZG .talentContent___2d5ZG");if(!inner)return"no container";var ch=inner.children[' + c.idx + '];if(!ch)return"no child";var cb=ch.querySelector(".ant-checkbox-input");if(!cb)return"no cb";if(cb.checked)return"already";cb.click();return"checked"})()');
  sleep(500);
  if (r === 'checked' || r === 'already') {
    checkOk++;
  } else {
    console.log('   ❌ ' + c.name + ': ' + r);
  }
}

console.log('   勾选完成: ' + checkOk + '/' + selected.length + '\n');

if (checkOk === 0) {
  console.log('❌ 没有人被勾选'); process.exit(1);
}

// ── Step 4: 点击批量"立即沟通"按钮 ──

if (dryRun) {
  console.log('🔇 DRY RUN — 跳过批量沟通');
  // 取消所有勾选
  for (const c of selected) {
    ev('(function(){var ch=document.querySelector(".talentContent___2d5ZG .talentContent___2d5ZG").children[' + c.idx + '];if(!ch)return;var cb=ch.querySelector(".ant-checkbox-input");if(cb&&cb.checked)cb.click()})()');
  }
  console.log('   已取消所有勾选');
  try { fs.unlinkSync(candidatesFile); } catch {}
  console.log('\n🎉 DRY RUN 完成（共勾选了 ' + checkOk + ' 人）');
  process.exit(0);
}

console.log('🚀 点击批量"立即沟通"...');

// 批量按钮在头部，class="mui-btn mui-btn-noBackground mui-btn-small"，文字"立即沟通"
const batchBtn = ev('(function(){var btns=[...document.querySelectorAll("button.mui-btn")].filter(function(e){return e.textContent.trim()==="立即沟通"&&e.className.includes("noBackground")&&e.offsetWidth>0});if(btns.length){btns[0].id="_batch_comm";return"found "+btns.length}else{return"not found"}})');

if (batchBtn.includes('found')) {
  click('#_batch_comm');
  sleep(2000);
} else {
  // 尝试用通用选择器
  console.log('   ⚠️ 未找到批量按钮，尝试通用方式...');
  const alt = ev('(function(){var els=[...document.querySelectorAll("*")].filter(function(e){return e.textContent.trim()==="立即沟通"&&e.className.includes("noBackground")&&e.offsetWidth>0});if(els.length){els[0].id="_batch_comm";return"alt found"}return"alt not found"})()');
  if (alt.includes('found')) {
    click('#_batch_comm');
    sleep(2000);
  } else {
    console.log('   ❌ 批量沟通按钮未找到');
    process.exit(1);
  }
}

// ── Step 5: 在弹窗中编辑消息并发送 ──

console.log('💬 编辑消息...');

// 检查弹窗
const modal = ev('(function(){var m=document.querySelector(".mui-modal-wrap");if(!m)return"no modal";return"open"})()');
if (!modal.includes('open')) {
  console.log('❌ 弹窗未打开');
  process.exit(1);
}

// 找消息输入框并替换内容
const inputType = ev('(function(){var m=document.querySelector(".mui-modal-wrap");var ta=m.querySelector("textarea");if(ta){ta.focus();ta.select();return"textarea"};var ce=m.querySelector("[contenteditable=true]");if(ce){ce.focus();return"contenteditable"};return"no input"})()');
sleep(300);

if (inputType !== 'no input') {
  // ⚠️ 关键：必须先清空输入框再填入文案，否则会追加而非替换
  // React 受控组件用 value="" 不够，需要 select → Backspace 真正清空状态
  ev('(function(){var m=document.querySelector(".mui-modal-wrap");var ta=m.querySelector("textarea");if(ta){ta.focus();ta.select();return"textarea selected"};var ce=m.querySelector("[contenteditable=true]");if(ce){ce.focus();var range=document.createRange();range.selectNodeContents(ce);var sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);return"ce selected"};return"no input"})()');
  sleep(300);

  // 通过 Backspace 删除选中的全部内容（清除 React 内部状态）
  // 使用 evalraw 直接发送 CDP Input.dispatchKeyEvent
  execSync('node ' + JSON.stringify(CDP) + ' evalraw ' + target + ' Input.dispatchKeyEvent ' + JSON.stringify(JSON.stringify({ type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 })), {
    timeout: 5000, encoding: 'utf8', stderr: 'pipe'
  });
  execSync('node ' + JSON.stringify(CDP) + ' evalraw ' + target + ' Input.dispatchKeyEvent ' + JSON.stringify(JSON.stringify({ type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 })), {
    timeout: 5000, encoding: 'utf8', stderr: 'pipe'
  });
  sleep(300);

  // 填入预制文案
  execSync('node ' + JSON.stringify(CDP) + ' type ' + target + ' ' + JSON.stringify(message), {
    timeout: 10000, encoding: 'utf8', stderr: 'pipe'
  });
  sleep(500);
}

// 确保勾选"发送后留在此页"
ev('(function(){var m=document.querySelector(".mui-modal-wrap");var els=[...m.querySelectorAll("*")].filter(function(e){return e.textContent.includes("留在此页")&&e.offsetWidth>0});if(els.length){var cb=els[0].querySelector(".ant-checkbox-input")||els[0].querySelector("input[type=checkbox]");if(cb&&!cb.checked)cb.click();return"set"}return"not found"})()');
sleep(300);

// 发送
const sendBtn = ev('(function(){var m=document.querySelector(".mui-modal-wrap");var btns=[...m.querySelectorAll("*")].filter(function(e){var t=e.textContent.trim();return(t==="发送"||t.includes("发送后"))&&e.offsetWidth>0&&e.children.length===0});if(btns.length){btns[0].id="_sendbtn";return"found"}return"not found"})()');

if (sendBtn.includes('found')) {
  click('#_sendbtn');
  console.log('✅ 已发送！');
  sleep(2000);
} else {
  console.log('❌ 发送按钮未找到');
}

// 清理临时文件
try { fs.unlinkSync(candidatesFile); } catch {}

console.log('\n🎉 完成');
