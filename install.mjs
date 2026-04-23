#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));

const SKILLS_DIR = path.join(__dirname, 'skills');
const SKILLS = fs.readdirSync(SKILLS_DIR).filter(d => {
  return fs.statSync(path.join(SKILLS_DIR, d)).isDirectory();
});

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function createRL() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function question(rl, text, defaultValue = '') {
  const prompt = defaultValue
    ? `${CYAN}? ${text} ${DIM}(${defaultValue})${RESET} `
    : `${CYAN}? ${text}${RESET} `;
  return new Promise(resolve => rl.question(prompt, answer => {
    resolve(answer.trim() || defaultValue);
  }));
}

async function confirm(rl, text) {
  const answer = await question(rl, `${text} (Y/n)`, 'Y');
  return answer.toUpperCase() === 'Y' || answer === '';
}

async function selectSkills(rl) {
  console.log(`\n${BOLD}可用的 Skills:${RESET}`);
  SKILLS.forEach((name, i) => {
    const skillMd = path.join(SKILLS_DIR, name, 'SKILL.md');
    let desc = '';
    if (fs.existsSync(skillMd)) {
      const content = fs.readFileSync(skillMd, 'utf-8');
      const m = content.match(/^description:\s*(.+)$/m);
      if (m) desc = m[1].trim().slice(0, 60);
    }
    console.log(`  ${GREEN}${i + 1}.${RESET} ${BOLD}${name}${RESET} ${DIM}— ${desc}${RESET}`);
  });

  const answer = await question(rl, '选择要安装的 skills（如 1,3,5 或 all）', 'all');
  if (answer.toLowerCase() === 'all') return SKILLS;

  const indices = answer.split(/[,，\s]+/).map(s => parseInt(s.trim(), 10) - 1);
  return indices.filter(i => i >= 0 && i < SKILLS.length).map(i => SKILLS[i]);
}

function getVersionMarker(targetDir) {
  return path.join(targetDir, '.maimai-qskills-version');
}

async function main() {
  const rl = createRL();

  console.log(`\n${BOLD}${CYAN}  maimai-qskills${RESET} v${pkg.version}\n`);

  // Check existing version
  const defaultTarget = path.join(process.env.HOME, '.openclaw/workspace/skills');
  const versionFile = getVersionMarker(defaultTarget);
  if (fs.existsSync(versionFile)) {
    const oldVersion = fs.readFileSync(versionFile, 'utf-8').trim();
    console.log(`${DIM}  检测到已安装版本: ${oldVersion}${RESET}`);
    if (oldVersion === pkg.version) {
      const yes = await confirm(rl, '已是最新版本，仍然要重新安装吗？');
      if (!yes) {
        console.log(`\n${GREEN}  已跳过。${RESET}\n`);
        rl.close();
        return;
      }
    }
  }

  // Ask for target path
  const targetDir = await question(rl, '安装路径', defaultTarget);
  const absoluteTarget = targetDir.startsWith('~')
    ? targetDir.replace('~', process.env.HOME)
    : path.resolve(targetDir);

  // Select skills
  const selected = await selectSkills(rl);

  if (selected.length === 0) {
    console.log(`\n${YELLOW}  未选择任何 skill，退出。${RESET}\n`);
    rl.close();
    return;
  }

  console.log(`\n${BOLD}  正在安装...${RESET}\n`);

  // Create target dir
  fs.mkdirSync(absoluteTarget, { recursive: true });

  // Copy selected skills
  for (const skill of selected) {
    const src = path.join(SKILLS_DIR, skill);
    const dest = path.join(absoluteTarget, skill);
    fs.cpSync(src, dest, { recursive: true, force: true });
    console.log(`  ${GREEN}✓${RESET} ${skill}`);
  }

  // Write version marker
  fs.writeFileSync(getVersionMarker(absoluteTarget), pkg.version);

  // file-explorer Python deps hint
  if (selected.includes('file-explorer')) {
    console.log(`\n${YELLOW}  file-explorer 需要 Python 依赖，请运行:${RESET}`);
    console.log(`  ${DIM}pip install pdfplumber python-docx openpyxl${RESET}`);
  }

  console.log(`\n${GREEN}${BOLD}  完成！${RESET} ${selected.length} 个 skill 已安装到 ${DIM}${absoluteTarget}${RESET}\n`);
  rl.close();
}

main().catch(err => {
  console.error(`\n${RED}  错误: ${err.message}${RESET}\n`);
  process.exit(1);
});
