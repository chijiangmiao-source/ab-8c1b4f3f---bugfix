#!/usr/bin/env node
// 一次性核验服务：依次执行代码测试、构建检查、HTTP 冒烟，
// 全部通过以退出码 0 自行退出，否则以退出码 1 退出并列出未通过项。
//
// 代码测试覆盖：卷积边界（越界项按零卷积）、双层最优规则
// （先 L1 后脉冲总数、字典序规范解）、存在同优计数的位置
// （计数集合与暴力枚举对拍）。

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const checks = [];

function record(name, ok, detail = '') {
  checks.push({ name, ok });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

function runStep(name, cmd, args) {
  console.log(`\n=== ${name} ===`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false });
  record(name, r.status === 0, `退出码 ${r.status === null ? '（信号终止）' : r.status}`);
  return r.status === 0;
}

async function get(path, tries = 12) {
  const base = (process.env.WEB_URL || 'http://web').replace(/\/+$/, '');
  let lastErr = '';
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(base + path);
      return { status: res.status, body: await res.text() };
    } catch (e) {
      lastErr = String(e);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return { status: 0, body: lastErr };
}

// 1. 代码测试：单元测试 + 暴力枚举对拍
runStep('代码测试：卷积边界 / 双层最优规则 / 同优计数位置（含随机对拍）', 'npm', [
  'run',
  'test:ci',
]);

// 2. 构建检查：类型检查 + 产物构建 + 产物完整性
runStep('构建检查：tsc 类型检查与 vite 静态构建', 'npm', ['run', 'build']);
let distOk = false;
let distDetail = 'dist/index.html 缺失';
try {
  if (existsSync('dist/index.html')) {
    const html = readFileSync('dist/index.html', 'utf8');
    distOk = html.includes('id="root"') && /assets\/.+\.js/.test(html);
    distDetail = distOk ? 'index.html 与打包资源齐全' : 'index.html 缺少挂载点或资源引用';
  }
} catch (e) {
  distDetail = String(e);
}
record('构建检查：dist 产物完整', distOk, distDetail);

// 3. HTTP 冒烟：健康检查与页面可达性
console.log('\n=== HTTP 冒烟 ===');
const health = await get('/health');
record('HTTP 冒烟：GET /health 返回 200', health.status === 200, `状态码 ${health.status}`);

const root = await get('/');
const rootOk = root.status === 200 && root.body.includes('id="root"');
record('HTTP 冒烟：GET / 返回 200 且含应用挂载点', rootOk, `状态码 ${root.status}`);

const assetMatch = root.body.match(/(?:src|href)="([^"]*assets\/[^"]+)"/);
if (assetMatch) {
  const assetPath = assetMatch[1].replace(/^\.?\//, '/'); // 归一化 ./assets/… 与 /assets/…
  const asset = await get(assetPath);
  record('HTTP 冒烟：打包静态资源可访问', asset.status === 200, `状态码 ${asset.status}`);
} else {
  record('HTTP 冒烟：打包静态资源可访问', false, '首页未引用打包资源');
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n核验汇总：${checks.length - failed.length}/${checks.length} 项通过`);
if (failed.length > 0) {
  console.log('未通过项：');
  for (const f of failed) console.log(`  - ${f.name}`);
}
process.exit(failed.length === 0 ? 0 : 1);
