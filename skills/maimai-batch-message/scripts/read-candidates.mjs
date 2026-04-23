import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const target = process.argv[2];
const outputFile = process.argv[3] || '/tmp/maimai-candidates.json';

if (!target) {
  console.log('用法: node read-candidates.mjs <target> [output-file]');
  process.exit(1);
}

const cdp = path.resolve(__dirname, '../../chrome-cdp/scripts/cdp.mjs');

const js = `JSON.stringify((function(){
  var inner = document.querySelector(".talentContent___2d5ZG .talentContent___2d5ZG");
  if (!inner) return {error: "no list container"};
  var candidates = [];
  for (var i = 0; i < inner.children.length; i++) {
    var ch = inner.children[i];
    var nameEl = ch.querySelector("[class*=name]");
    if (!nameEl || !nameEl.textContent.trim()) continue;
    var name = nameEl.textContent.trim();
    var cb = ch.querySelector("input.ant-checkbox-input");
    var btns = ch.querySelectorAll(".mui-btn-primary");
    var hasCommBtn = false, alreadyContacted = false;
    for (var j = 0; j < btns.length; j++) {
      var t = btns[j].textContent.trim();
      if (t === "立即沟通" && btns[j].offsetWidth > 0) hasCommBtn = true;
      if (t === "沟通" && btns[j].offsetWidth > 0 && !hasCommBtn) alreadyContacted = true;
    }
    candidates.push({
      idx: i, name: name,
      info: ch.innerText.substring(0, 600).replace(/\\n/g, " | "),
      checked: cb ? cb.checked : false,
      canContact: hasCommBtn,
      alreadyContacted: alreadyContacted
    });
  }
  return candidates;
})())`;

try {
  const result = execSync(`node "${cdp}" eval ${target} '${js}'`, {
    timeout: 15000, encoding: 'utf8', stderr: 'pipe'
  }).trim();

  if (result.includes('"error"')) {
    console.log('❌ ' + result.substring(0, 200));
    process.exit(1);
  }

  fs.writeFileSync(outputFile, result);
  const data = JSON.parse(result);
  const can = data.filter(d => d.canContact).length;
  const already = data.filter(d => d.alreadyContacted).length;

  console.log(`✓ 共 ${data.length} 人 (可沟通 ${can}, 已联系 ${already})`);
  console.log(`📄 保存到: ${outputFile}\n`);
  console.log('--- 候选人列表 ---');
  for (const d of data) {
    let s = '❌';
    if (d.alreadyContacted) s = '🔒已联系';
    else if (d.canContact) s = '✅可沟通';
    const ck = d.checked ? ' ☑' : '';
    console.log(`  ${String(d.idx).padStart(2)}. ${d.name.padEnd(14)} ${s}${ck}`);
  }
} catch (e) {
  console.log('❌ ' + e.message.substring(0, 300));
  if (e.stderr) console.log(e.stderr.substring(0, 200));
  process.exit(1);
}
