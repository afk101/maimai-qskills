#!/usr/bin/env node

import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = import.meta.dirname;
const SOURCE = path.join(process.env.HOME, '.openclaw/workspace/skills');
const TARGET = path.join(ROOT, 'skills');

const SKILLS = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills-list.json'), 'utf-8'));

const EXCLUDES = [
  '--exclude=.DS_Store',
  '--exclude=.venv',
  '--exclude=__pycache__',
  '--exclude=.pytest_cache',
];

console.log(`同步 skills: ${SOURCE} → ${TARGET}\n`);

// Clean target first: remove skills not in list
for (const existing of fs.readdirSync(TARGET).filter(d =>
  fs.statSync(path.join(TARGET, d)).isDirectory()
)) {
  if (!SKILLS.includes(existing)) {
    fs.rmSync(path.join(TARGET, existing), { recursive: true, force: true });
    console.log(`  - ${existing} (removed)`);
  }
}

for (const skill of SKILLS) {
  const src = path.join(SOURCE, skill);
  const dest = path.join(TARGET, skill);
  if (!fs.existsSync(src)) {
    console.log(`  ! ${skill} (not found in source, skipped)`);
    continue;
  }
  execSync(`rsync -a ${EXCLUDES.join(' ')} ${src} ${TARGET}`, { stdio: 'pipe' });
  console.log(`  ✓ ${skill}`);
}

console.log(`\n完成。可以执行 node publish.mjs 发布。`);
