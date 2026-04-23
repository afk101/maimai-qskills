#!/usr/bin/env node
// send-keys.cjs — 通过 CDP daemon socket 批量发送键盘事件（极快）
// 用法: node send-keys.cjs <target> <key> <count> [--sleep N]
//   key: ArrowDown, ArrowUp, Enter, Home 等
//   count: 重复次数
//   --sleep: 每次按键间隔ms（默认 15）

const { resolve } = require('path');
const { existsSync, unlinkSync } = require('fs');
const net = require('net');
const os = require('os');

const target = process.argv[2];
const key = process.argv[3];
const count = parseInt(process.argv[4]) || 1;
const sleepIdx = process.argv.indexOf('--sleep');
const sleepMs = sleepIdx !== -1 ? parseInt(process.argv[sleepIdx + 1]) || 200 : 200;

if (!target || !key) {
  console.error('Usage: node send-keys.cjs <target> <key> <count> [--sleep N]');
  process.exit(1);
}

// Key mapping
const keyMap = {
  'ArrowDown': { code: 'ArrowDown', key: 'ArrowDown', vk: 40 },
  'ArrowUp': { code: 'ArrowUp', key: 'ArrowUp', vk: 38 },
  'Enter': { code: 'Enter', key: 'Enter', vk: 13 },
  'Home': { code: 'Home', key: 'Home', vk: 36 },
  'End': { code: 'End', key: 'End', vk: 35 },
  'Escape': { code: 'Escape', key: 'Escape', vk: 27 },
};

const km = keyMap[key];
if (!km) { console.error('Unknown key: ' + key); process.exit(1); }

// Socket path
const IS_WINDOWS = process.platform === 'win32';
const RUNTIME_DIR = IS_WINDOWS
  ? resolve(process.env.LOCALAPPDATA || process.env.APPDATA || '', 'cdp')
  : process.env.XDG_RUNTIME_DIR
    ? resolve(process.env.XDG_RUNTIME_DIR, 'cdp')
    : resolve(os.tmpdir(), 'cdp');
const sockPath = resolve(RUNTIME_DIR, `cdp-${target}.sock`);

if (!existsSync(sockPath)) {
  // Trigger daemon start by running cdp.mjs list
  const { execSync } = require('child_process');
  const cdp = resolve(__dirname, '../../chrome-cdp/scripts/cdp.mjs');
  try { execSync(`node "${cdp}" list`, { timeout: 8000, encoding: 'utf8', stdio: 'pipe' }); } catch {}
  if (!existsSync(sockPath)) {
    console.error('Daemon socket not found: ' + sockPath);
    process.exit(1);
  }
}

// Connect and send all events through one connection
let cmdId = 1;

function sendCmd(conn, cmd, args) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString();
      const idx = buf.indexOf('\n');
      if (idx === -1) return;
      conn.off('data', onData);
      try { resolve(JSON.parse(buf.slice(0, idx))); } catch (e) { reject(e); }
    };
    conn.on('data', onData);
    conn.write(JSON.stringify({ id: cmdId++, cmd, args }) + '\n');
  });
}

async function main() {
  const conn = await new Promise((resolve, reject) => {
    const c = net.connect(sockPath);
    c.on('connect', () => resolve(c));
    c.on('error', reject);
  });

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  for (let i = 0; i < count; i++) {
    await sendCmd(conn, 'evalraw', [
      'Input.dispatchKeyEvent',
      JSON.stringify({ type: 'keyDown', code: km.code, key: km.key, windowsVirtualKeyCode: km.vk })
    ]);
    if (sleepMs > 0) await sleep(sleepMs);
    await sendCmd(conn, 'evalraw', [
      'Input.dispatchKeyEvent',
      JSON.stringify({ type: 'keyUp', code: km.code, key: km.key, windowsVirtualKeyCode: km.vk })
    ]);
    if (sleepMs > 0) await sleep(sleepMs);
  }

  conn.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
