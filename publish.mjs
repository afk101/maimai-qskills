#!/usr/bin/env node

import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';

const ROOT = import.meta.dirname;
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

const GREEN = '\x1b[32m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function question(text, defaultValue = '') {
  const prompt = defaultValue
    ? `${text} ${DIM}(${defaultValue})${RESET} `
    : `${text} `;
  return new Promise(resolve => rl.question(prompt, answer => {
    resolve(answer.trim() || defaultValue);
  }));
}

async function main() {
  console.log(`\n${BOLD}  发布 maimai-qskills${RESET}  当前版本: ${pkg.version}\n`);

  // 1. sync
  console.log(`${DIM}[1/3] 同步源文件...${RESET}`);
  execSync('node sync.mjs', { cwd: ROOT, stdio: 'inherit' });

  // 1.5 git add so npm version sees a clean tree
  execSync('git add -A', { cwd: ROOT, stdio: 'pipe' });

  // 2. version bump
  console.log(`\n${DIM}[2/3] 版本升级${RESET}`);
  const bump = await question('  升级类型 (patch/minor/major)', 'patch');
  if (!['patch', 'minor', 'major'].includes(bump)) {
    console.log(`\n  无效选项，退出。`);
    rl.close();
    process.exit(1);
  }
  execSync(`npm version ${bump}`, { cwd: ROOT, stdio: 'inherit' });

  // read new version
  const newPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  console.log(`\n  新版本: ${GREEN}${newPkg.version}${RESET}`);

  // 3. publish
  console.log(`\n${DIM}[3/3] 发布到 npm${RESET}`);
  execSync('npm publish', { cwd: ROOT, stdio: 'inherit' });

  console.log(`\n${GREEN}${BOLD}  发布成功！${RESET} v${newPkg.version}`);
  console.log(`  用户更新命令: ${DIM}npx maimai-qskills@latest${RESET}\n`);
  rl.close();
}

main().catch(err => {
  console.error(`\n  错误: ${err.message}`);
  rl.close();
  process.exit(1);
});
