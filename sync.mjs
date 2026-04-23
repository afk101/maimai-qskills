#!/usr/bin/env node

import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const SOURCE = path.join(process.env.HOME, '.openclaw/workspace/skills');
const TARGET = path.join(import.meta.dirname, 'skills');

const SKILLS = fs.readdirSync(SOURCE).filter(d =>
  fs.statSync(path.join(SOURCE, d)).isDirectory()
);

const EXCLUDES = [
  '--exclude=.DS_Store',
  '--exclude=.venv',
  '--exclude=__pycache__',
  '--exclude=.pytest_cache',
];

console.log(`同步 skills: ${SOURCE} → ${TARGET}\n`);

for (const skill of SKILLS) {
  const src = path.join(SOURCE, skill);
  const dest = path.join(TARGET, skill);
  const cmd = ['rsync', '-a', ...EXCLUDES, src, TARGET].join(' ');
  execSync(cmd, { stdio: 'pipe' });
  console.log(`  ✓ ${skill}`);
}

console.log(`\n完成。可以执行 npm version patch && npm publish 发布。`);
