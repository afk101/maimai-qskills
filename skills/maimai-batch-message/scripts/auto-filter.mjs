#!/usr/bin/env node
// 脉脉人才银行 - 自动搜索+筛选脚本
// 用法: node auto-filter.mjs <target> --keyword <关键词> [选项]
//   选项: --city --education --experience --gender --age-min --age-max --no-search --no-filter

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CDP = path.resolve(__dirname, '../../chrome-cdp/scripts/cdp.mjs');

// ── CDP eval: 通过临时文件传递 JS 表达式，彻底避免 shell 引号问题 ──

let _tmpCounter = 0;
function ev(target, js, timeoutMs) {
  timeoutMs = timeoutMs || 12000;
  const tmpJs = '/tmp/_ce_js_' + process.pid + '_' + (++_tmpCounter) + '.js';
  const tmpOut = '/tmp/_ce_out_' + process.pid + '_' + _tmpCounter + '.txt';
  // 写入 JS：读取文件内容，调用 cdp.mjs execFileSync，结果写入输出文件
  const wrapper =
    'const js=require("fs").readFileSync(' + JSON.stringify(tmpJs) + ',"utf8");\n' +
    'try{var r=require("child_process").execFileSync(' + JSON.stringify(CDP) + ',["eval",' + JSON.stringify(target) + ',js],{encoding:"utf8",timeout:' + timeoutMs + '});\n' +
    'require("fs").writeFileSync(' + JSON.stringify(tmpOut) + ',r)}\n' +
    'catch(e){require("fs").writeFileSync(' + JSON.stringify(tmpOut) + ',"__ERR__"+e.message)}';
  const tmpRun = '/tmp/_ce_run_' + process.pid + '_' + _tmpCounter + '.cjs';
  fs.writeFileSync(tmpJs, js);
  fs.writeFileSync(tmpRun, wrapper);
  try {
    execSync('node ' + tmpRun, { timeout: timeoutMs + 5000, encoding: 'utf8', stderr: 'pipe' });
    const out = fs.readFileSync(tmpOut, 'utf8').trim();
    if (out.startsWith('__ERR__')) throw new Error(out.substring(6));
    return out;
  } finally {
    [tmpJs, tmpOut, tmpRun].forEach(f => { try { fs.unlinkSync(f); } catch {} });
  }
}

function sleep(ms) {
  execSync('sleep ' + Math.max(1, Math.round(ms) / 1000), { timeout: Math.round(ms) + 3000 });
}

function cdpRun(target, subcmd) {
  return execSync('node ' + JSON.stringify(CDP) + ' ' + subcmd, { timeout: 10000, encoding: 'utf8', stderr: 'pipe' }).trim();
}

// ── 搜索 ──

function searchKeyword(target, keyword) {
  ev(target, '(function(){var i=document.querySelector("input.ant-input");i.focus();i.click();i.select();document.execCommand("selectAll");document.execCommand("delete");return"ok"})()');
  sleep(300);
  cdpRun(target, 'type ' + target + ' ' + JSON.stringify(keyword));
  sleep(500);
  const icon = JSON.parse(ev(target, '(function(){var e=document.querySelector(".iconContent___1PZTv");if(!e)return JSON.stringify({error:"no icon"});var r=e.getBoundingClientRect();return JSON.stringify({cx:Math.round(r.left+r.width/2),cy:Math.round(r.top+r.height/2)})})()'));
  if (icon.error) return 0;
  cdpRun(target, 'clickxy ' + target + ' ' + icon.cx + ' ' + icon.cy);
  for (let i = 0; i < 8; i++) {
    sleep(2000);
    try {
      const r = JSON.parse(ev(target, '(function(){var d=document.querySelector(".talentContent___2d5ZG .talentContent___2d5ZG");if(!d)return{n:0};var ns=d.querySelectorAll("[class*=name]");var c=0;for(var i=0;i<ns.length;i++)if(ns[i].textContent.trim())c++;return{n:c}})()'));
      if (r.n > 0) return r.n;
    } catch {}
  }
  return 0;
}

// ── 简单下拉筛选 ──

function simpleFilter(target, filterName, value) {
  ev(target,
    '(function(){var c=document.querySelector(".recruitTalentsContainer___1xYaW");if(c)c.scrollTop=0;' +
    'var hs=document.querySelectorAll(".header___4eAyg");' +
    'for(var i=0;i<hs.length;i++){if(hs[i].textContent.includes("' + filterName + '")){' +
    'hs[i].dispatchEvent(new MouseEvent("mousedown",{bubbles:true}));' +
    'hs[i].dispatchEvent(new MouseEvent("mouseup",{bubbles:true}));' +
    'hs[i].dispatchEvent(new MouseEvent("click",{bubbles:true}));return"ok"}}return"not found"})()');
  sleep(800);
  // 只在下拉弹出层（position:fixed 的可见容器）内搜索，避免点到候选人卡片
  const r = ev(target,
    '(function(){var pops=[...document.querySelectorAll("*")].filter(function(e){' +
    'var s=getComputedStyle(e);return(s.position==="fixed"||s.position==="absolute")&&e.offsetHeight>30&&e.offsetWidth>50});' +
    'for(var p=0;p<pops.length;p++){' +
    'var its=pops[p].querySelectorAll("*");' +
    'for(var i=0;i<its.length;i++){' +
    'if(its[i].textContent.trim()==="' + value + '"&&its[i].offsetWidth>0&&its[i].children.length===0){its[i].click();return"clicked"}}}' +
    'return"not found"})()');
  sleep(800);
  return r === 'clicked';
}

// ── 学历筛选 ──

function educationFilter(target, value) {
  ev(target,
    '(function(){var c=document.querySelector(".recruitTalentsContainer___1xYaW");if(c)c.scrollTop=0;' +
    'var hs=document.querySelectorAll(".header___4eAyg");' +
    'for(var i=0;i<hs.length;i++){if(hs[i].textContent.includes("学历要求")){' +
    'hs[i].dispatchEvent(new MouseEvent("mousedown",{bubbles:true}));' +
    'hs[i].dispatchEvent(new MouseEvent("mouseup",{bubbles:true}));' +
    'hs[i].dispatchEvent(new MouseEvent("click",{bubbles:true}));return"ok"}}return"not found"})()');
  sleep(800);
  ev(target,
    '(function(){var its=document.querySelectorAll(".content___6LPBl");for(var i=0;i<its.length;i++){' +
    'if(its[i].textContent.trim()==="' + value + '"&&its[i].offsetWidth>0){' +
    'its[i].dispatchEvent(new MouseEvent("mousedown",{bubbles:true}));' +
    'its[i].dispatchEvent(new MouseEvent("mouseup",{bubbles:true}));' +
    'its[i].dispatchEvent(new MouseEvent("click",{bubbles:true}));return"ok"}}return"not found"})()');
  sleep(600);
  ev(target,
    '(function(){var its=document.querySelectorAll(".sub-select-item___WIk5U");for(var i=0;i<its.length;i++){' +
    'if(its[i].textContent.trim()==="不限"&&its[i].offsetWidth>0){' +
    'its[i].dispatchEvent(new MouseEvent("mousedown",{bubbles:true}));' +
    'its[i].dispatchEvent(new MouseEvent("mouseup",{bubbles:true}));' +
    'its[i].dispatchEvent(new MouseEvent("click",{bubbles:true}));return"ok"}}return"no sub"})()');
  sleep(600);
  return true;
}

// ── 年龄筛选（调用 set-age.cjs 脚本） ──

function ageFilter(target, minAge, maxAge) {
  const script = path.resolve(__dirname, 'set-age.cjs');
  try {
    const result = execSync('node ' + JSON.stringify(script) + ' ' + target + ' ' + minAge + ' ' + maxAge, {
      timeout: 120000, encoding: 'utf8', stderr: 'pipe'
    }).trim();
    console.log(result.split('\n').map(l => '      ' + l).join('\n'));
    return result.includes('✅ 成功');
  } catch (e) {
    console.log('      ❌ ' + e.message.substring(0, 100));
    return false;
  }
}

// ── Main ──

const args = process.argv.slice(2);
const target = args[0];
if (!target) { console.log('用法: node auto-filter.mjs <target> --keyword <关键词> [选项]'); process.exit(1); }

function getOpt(name, fallback) {
  const idx = args.indexOf('--' + name);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : fallback;
}

const keyword = getOpt('keyword', '');
const city = getOpt('city', '北京');
const education = getOpt('education', '本科及以上');
const experience = getOpt('experience', '3-5年');
const gender = getOpt('gender', '男');
const ageMin = parseInt(getOpt('age-min', '25'));
const ageMax = parseInt(getOpt('age-max', '33'));
const noSearch = args.includes('--no-search');
const noFilter = args.includes('--no-filter');

// 验证
console.log('🔍 验证页面...');
try {
  const page = JSON.parse(ev(target, '(function(){var i=document.querySelector("input.ant-input");return JSON.stringify({ok:!!i,title:document.title})})()'));
  if (!page.ok) { console.log('❌ 未找到搜索框'); process.exit(1); }
  console.log('   ✓ ' + page.title);
} catch (e) { console.log('❌ 连接失败: ' + e.message.substring(0, 80)); process.exit(1); }

// 搜索
if (!noSearch && keyword) {
  console.log('\n📝 搜索: "' + keyword + '"');
  const count = searchKeyword(target, keyword);
  console.log('   ' + (count > 0 ? '✓ ' + count + ' 位候选人' : '❌ 搜索失败'));
  if (!count) process.exit(1);
}

// 筛选
if (!noFilter) {
  console.log('\n🎛 筛选条件:');
  console.log('   城市 ' + city + ': ' + (simpleFilter(target, '城市地区', city) ? '✓' : '❌'));
  console.log('   工作年限 ' + experience + ': ' + (simpleFilter(target, '工作年限', experience) ? '✓' : '❌'));
  console.log('   性别 ' + gender + ': ' + (simpleFilter(target, '性别', gender) ? '✓' : '❌'));
  console.log('   学历 ' + education + ': ' + (educationFilter(target, education) ? '✓' : '❌'));
  console.log('   年龄 ' + ageMin + '-' + ageMax + ':');
  ageFilter(target, ageMin, ageMax);

  ev(target, 'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",code:"Escape",keyCode:27}))');
  sleep(500);
  console.log('\n⏳ 等待筛选结果 (3s)...');
  sleep(3000);
}

// 统计
console.log('\n📊 结果:');
try {
  const count = JSON.parse(ev(target, '(function(){var d=document.querySelector(".talentContent___2d5ZG .talentContent___2d5ZG");if(!d)return{error:"no list"};var ns=d.querySelectorAll("[class*=name]");var c=0;for(var i=0;i<ns.length;i++)if(ns[i].textContent.trim())c++;return{n:c}})()'));
  if (count.error) console.log('   ❌ ' + count.error);
  else console.log('   ✅ 共 ' + count.n + ' 位候选人');
} catch (e) { console.log('   ❌ 统计失败'); }

console.log('\n🎉 完成');
