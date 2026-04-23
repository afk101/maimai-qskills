#!/usr/bin/env node
// set-age.cjs — 脉脉年龄筛选（搜索重置方案）
// 策略：先重置搜索（清空再搜索），所有筛选回到"不限"，再 ArrowDown
// 点击不限，跳出来选中的是不限，然后开始从16开始是最低年龄，接着是选最高年龄，点击跳出来也是不限，然后从刚刚最低年龄选的值开始的，所以移动的次数分别是minAge - 15和maxAge - minAge + 1
// 用法: node set-age.cjs <target> <minAge> <maxAge>

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const target = process.argv[2] || 'C33B9DB1';
const minAge = parseInt(process.argv[3], 10);
const maxAge = parseInt(process.argv[4], 10);
if (isNaN(minAge) || isNaN(maxAge)) {
  console.error('Usage: node set-age.cjs <target> <minAge> <maxAge>');
  process.exit(1);
}

const CDP = path.resolve(__dirname, '../../chrome-cdp/scripts/cdp.mjs');

function run(cmd, timeout) {
  try { return execSync(cmd, { encoding: 'utf8', timeout: timeout || 12000, stdio: ['pipe','pipe','pipe'] }).trim(); } catch { return null; }
}

function ev(js) {
  const tmp = `/tmp/_sa_${Date.now()}.js`;
  fs.writeFileSync(tmp, js);
  const r = run(`node "${CDP}" eval ${target} @${tmp}`);
  try { fs.unlinkSync(tmp); } catch {}
  return r;
}

function raw(method, obj) {
  const tmp = `/tmp/_sa_${Date.now()}.json`;
  fs.writeFileSync(tmp, JSON.stringify(obj));
  const r = run(`node "${CDP}" evalraw ${target} ${method} @${tmp}`);
  try { fs.unlinkSync(tmp); } catch {}
  return r;
}

// 预创建按键 JSON
fs.writeFileSync('/tmp/_sa_kd.json', JSON.stringify({ type: 'keyDown', code: 'ArrowDown', key: 'ArrowDown', windowsVirtualKeyCode: 40 }));
fs.writeFileSync('/tmp/_sa_ku.json', JSON.stringify({ type: 'keyUp', code: 'ArrowDown', key: 'ArrowDown', windowsVirtualKeyCode: 40 }));
fs.writeFileSync('/tmp/_sa_ed.json', JSON.stringify({ type: 'keyDown', code: 'Enter', key: 'Enter', windowsVirtualKeyCode: 13 }));
fs.writeFileSync('/tmp/_sa_eu.json', JSON.stringify({ type: 'keyUp', code: 'Enter', key: 'Enter', windowsVirtualKeyCode: 13 }));

function arrowDown(count) {
  if (count <= 0) return;
  run(`for i in $(seq 1 ${count}); do node "${CDP}" evalraw ${target} Input.dispatchKeyEvent @/tmp/_sa_kd.json; sleep 0.08; node "${CDP}" evalraw ${target} Input.dispatchKeyEvent @/tmp/_sa_ku.json; sleep 0.15; done`);
}

function pressEnter() {
  run(`node "${CDP}" evalraw ${target} Input.dispatchKeyEvent @/tmp/_sa_ed.json; sleep 0.1; node "${CDP}" evalraw ${target} Input.dispatchKeyEvent @/tmp/_sa_eu.json`);
}

// ── Main ──
console.log(`🔧 设置年龄 ${minAge}-${maxAge}...`);

// 1. 关闭模态弹窗
ev(`(function(){var m=document.querySelector(".mui-modal-mask");if(m){m.click();return"closed"}return"none"})()`);
run('sleep 0.3');

// 2. 滚到顶部
ev(`(function(){var c=document.querySelector(".recruitTalentsContainer___1xYaW");if(c)c.scrollTop=0;return"ok"})()`);
run('sleep 0.3');

// 3. 打开年龄面板
ev('(function(){var h=[...document.querySelectorAll(".header___4eAyg")].find(function(e){return e.textContent.includes("年龄")});if(h)h.id="_af";return"ok"})()');
run('sleep 0.2');
run(`node "${CDP}" click ${target} "#_af"`);
run('sleep 0.8');

// 4. 获取面板信息
const infoStr = ev(`(function(){var p=document.querySelector(".customizeContent___3W7gV");if(!p)return JSON.stringify({error:"no panel"});var ss=p.querySelectorAll(".mui-select");var r1=ss[0].getBoundingClientRect(),r2=ss[1].getBoundingClientRect();var btns=[...p.querySelectorAll("*")].filter(function(e){return e.textContent.trim()==="确定"&&e.offsetWidth>0&&!e.children.length});var br=btns[0].getBoundingClientRect();return JSON.stringify({s1cx:+(r1.left+r1.width/2|0),s1cy:+(r1.top+r1.height/2|0),s2cx:+(r2.left+r2.width/2|0),s2cy:+(r2.top+r2.height/2|0),bcx:+(br.left+br.width/2|0),bcy:+(br.top+br.height/2|0),s1:ss[0].textContent.trim(),s2:ss[1].textContent.trim()})})()`);
const info = JSON.parse(infoStr || '{}');
if (info.error) { console.error('❌', info.error); process.exit(1); }

function parseAgeVal(text) {
  if (text.includes('不限')) return -1;
  const m = text.match(/(\d+)岁/);
  return m ? parseInt(m[1]) : -1;
}

const curMin = parseAgeVal(info.s1);
const curMax = parseAgeVal(info.s2);
console.log(`📋 当前: 最小=${curMin < 0 ? '不限' : curMin}, 最大=${curMax < 0 ? '不限' : curMax}`);

// 5. 如果不是"不限"，需要重置。方法：Escape 关闭面板 → 清空搜索框 → Enter 搜索 → 所有筛选重置
function resetAndReopen() {
  console.log('🔄 重置筛选...');

  // 读取当前搜索词
  const keyword = ev('(function(){var u=new URL(location.href);return u.searchParams.get("query")||""})()');

  // Escape 关闭面板
  ev('(function(){document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",code:"Escape",keyCode:27}))})()');
  run('sleep 0.5');

  if (keyword) {
    // 重新搜索同一个关键词（会重置所有筛选）
    ev('(function(){var i=document.querySelector("input[placeholder*=按职位]");if(i){i.focus();i.select();return"found"}return"no input"})()');
    run('sleep 0.2');
    run(`node "${CDP}" type ${target} ${JSON.stringify(keyword)}`);
    run('sleep 0.3');
    pressEnter();
    run('sleep 3');
  }

  // 重新打开面板
  ev('(function(){var h=[...document.querySelectorAll(".header___4eAyg")].find(function(e){return e.textContent.includes("年龄")});if(h)h.id="_af";return"ok"})()');
  run('sleep 0.2');
  run(`node "${CDP}" click ${target} "#_af"`);
  run('sleep 1.0');
}

if (curMin >= 0 || curMax >= 0) {
  resetAndReopen();

  // 重新读面板
  const infoStr2 = ev(`(function(){var p=document.querySelector(".customizeContent___3W7gV");if(!p)return JSON.stringify({error:"no panel"});var ss=p.querySelectorAll(".mui-select");var r1=ss[0].getBoundingClientRect(),r2=ss[1].getBoundingClientRect();var btns=[...p.querySelectorAll("*")].filter(function(e){return e.textContent.trim()==="确定"&&e.offsetWidth>0&&!e.children.length});var br=btns[0].getBoundingClientRect();return JSON.stringify({s1cx:+(r1.left+r1.width/2|0),s1cy:+(r1.top+r1.height/2|0),s2cx:+(r2.left+r2.width/2|0),s2cy:+(r2.top+r2.height/2|0),bcx:+(br.left+br.width/2|0),bcy:+(br.top+br.height/2|0),s1:ss[0].textContent.trim(),s2:ss[1].textContent.trim()})})()`);
  const info2 = JSON.parse(infoStr2 || '{}');
  if (info2.error) { console.error('❌ 重置后面板未打开'); process.exit(1); }
  console.log(`📋 重置后: 最小=${info2.s1}, 最大=${info2.s2}`);
  // 更新 info
  Object.assign(info, info2);
}

// 6. 操作 select（都从"不限"出发，只用 ArrowDown）
function mouseClick(x, y) {
  raw('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  run('sleep 0.12');
  raw('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

console.log(`⚙ 最小年龄 ${minAge}...`);
mouseClick(info.s1cx, info.s1cy);
run('sleep 1.5');
const downs1 = minAge - 15;
console.log(`  ArrowDown×${downs1}`);
arrowDown(downs1);
run('sleep 0.15');
pressEnter();
run('sleep 0.5');

console.log(`⚙ 最大年龄 ${maxAge}...`);
mouseClick(info.s2cx, info.s2cy);
run('sleep 1.5');
const downs2 = maxAge - minAge + 1;
console.log(`  ArrowDown×${downs2}`);
arrowDown(downs2);
run('sleep 0.15');
pressEnter();
run('sleep 0.5');

// 7. 确定
console.log('✅ 确定...');
mouseClick(info.bcx, info.bcy);
run('sleep 2');

// 8. 验证
const vStr = ev(`(function(){var t="";[...document.querySelectorAll(".header___4eAyg")].forEach(function(e){if(e.textContent.includes("年龄"))t=e.textContent.trim()});var n=document.querySelectorAll(".talentContent___2d5ZG").length;return JSON.stringify({age:t,count:n})})()`);
if (vStr) {
  const v = JSON.parse(vStr);
  console.log(`📊 结果: ${v.age} | ${v.count} 位候选人`);
  const match = v.age.includes(`${minAge}岁`) && v.age.includes(`${maxAge}岁`);
  console.log(match ? '✅ 成功！' : '⚠️ 不匹配');
}
