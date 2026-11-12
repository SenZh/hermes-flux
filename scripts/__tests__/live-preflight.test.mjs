import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  FINGERPRINT_FILES,
  assessDistFreshness,
  collectArtifactFingerprint,
  describePortOccupant,
  formatOccupiedReport,
  formatStaleReport,
  hashFileSync,
  probePortOpen,
} from '../lib/live-preflight.mjs';

/**
 * 浏览器直跑启动自检的单元与集成测试
 *
 * 【设计意图 (Why)】
 *   自检的全部价值在于「能识破别的 worktree 占着端口」这一历史事故。本测试用真实
 *   回环 HTTP 服务扮演「占用者」，用真实临时目录扮演「本仓 dist」，验证自检在
 *   「字节一致」与「字节不一致」两种物理情形下给出相反且正确的结论，
 *   杜绝仅靠字符串断言源码文本的假测试。
 *
 * 【防范的历史坑 (Pitfall)】
 *   实测事故：9120 被 D:\ws\hermes-aura-input-model-redesign 的残留进程占住，
 *   该 worktree 的 conversation.css 为 87909B（不含提示词导航器加载动画），
 *   本仓 dev/v0.1 为 74203B（含该动画）。据此误判「提示词导航器优化没生效」。
 *
 * 【约束与规则 (Rules)】
 *   端口一律 listen(0) 动态分配；临时目录必须在 after 钩子清理；
 *   断言必须落在「结论字段」上（sameBytes / stale / exitCode 语义），而非日志文本。
 */

function tempRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-preflight-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function serveFiles(files) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/__live/identity') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ root: '/other/worktree', branch: 'feat/other', files: {} }));
      return;
    }
    const rel = url.pathname.replace(/^\//, '');
    const body = files[rel];
    if (body === undefined) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

test('产物指纹：逐文件哈希并可合成总指纹，缺失文件显式记录', async (t) => {
  const root = tempRepo({
    [FINGERPRINT_FILES[0]]: 'body{color:red}',
    [FINGERPRINT_FILES[1]]: 'console.log(1)',
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const fp = collectArtifactFingerprint(root);
  assert.equal(fp.missing.length, 0);
  assert.equal(fp.files[FINGERPRINT_FILES[0]].hash, sha256('body{color:red}'));
  assert.equal(fp.files[FINGERPRINT_FILES[1]].hash, sha256('console.log(1)'));
  assert.equal(fp.combined.length, 64, '总指纹必须是 sha256 十六进制串');

  const empty = tempRepo({});
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));
  const emptyFp = collectArtifactFingerprint(empty);
  assert.deepEqual(emptyFp.missing.sort(), [...FINGERPRINT_FILES].sort(), '全部缺失必须逐条记录');
  assert.equal(emptyFp.combined, '', '无任何文件时不得合成出非空指纹冒充一致');
});

test('总指纹对「文件内容」敏感，且与文件写入顺序无关', async (t) => {
  const a = tempRepo({
    [FINGERPRINT_FILES[0]]: 'AAA',
    [FINGERPRINT_FILES[1]]: 'BBB',
  });
  const b = tempRepo({
    [FINGERPRINT_FILES[1]]: 'BBB',
    [FINGERPRINT_FILES[0]]: 'AAA',
  });
  const c = tempRepo({
    [FINGERPRINT_FILES[0]]: 'AAA',
    [FINGERPRINT_FILES[1]]: 'CCC',
  });
  t.after(() => {
    for (const dir of [a, b, c]) fs.rmSync(dir, { recursive: true, force: true });
  });

  assert.equal(
    collectArtifactFingerprint(a).combined,
    collectArtifactFingerprint(b).combined,
    '写入顺序不同但内容相同，总指纹必须一致'
  );
  assert.notEqual(
    collectArtifactFingerprint(a).combined,
    collectArtifactFingerprint(c).combined,
    '任一文件内容变化必须改变总指纹，否则识别不出别的分支产物'
  );
});

test('端口探测：空闲为 false，被监听为 true', async (t) => {
  const probe = http.createServer((_req, res) => res.end());
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const busyPort = probe.address().port;
  t.after(() => new Promise((resolve) => probe.close(resolve)));

  assert.equal(await probePortOpen(busyPort), true);

  await new Promise((resolve) => probe.close(resolve));
  assert.equal(await probePortOpen(busyPort), false, '端口关闭后必须判定为空闲');
});

test('占用者字节与本仓一致 ⇒ sameBytes=true（同一仓库的实例已在运行）', async (t) => {
  const css = 'body{color:gold}';
  const js = 'console.log("flux")';
  const local = tempRepo({
    [FINGERPRINT_FILES[0]]: css,
    [FINGERPRINT_FILES[1]]: js,
  });
  t.after(() => fs.rmSync(local, { recursive: true, force: true }));

  const { server, port } = await serveFiles({
    [FINGERPRINT_FILES[0]]: css,
    [FINGERPRINT_FILES[1]]: js,
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const occupant = await describePortOccupant({
    port,
    local: collectArtifactFingerprint(local),
  });

  assert.equal(occupant.occupied, true);
  assert.equal(occupant.sameBytes, true);
  assert.equal(occupant.identity?.branch, 'feat/other', '必须读取占用者的自我声明');
});

test('占用者字节与本仓不同 ⇒ sameBytes=false，并报出两份指纹差异', async (t) => {
  const local = tempRepo({
    [FINGERPRINT_FILES[0]]: 'body{color:gold}',
    [FINGERPRINT_FILES[1]]: 'console.log("flux")',
  });
  t.after(() => fs.rmSync(local, { recursive: true, force: true }));

  // 复刻真实事故形态：占用者的 css 体积不同（87909B vs 74203B）
  const { server, port } = await serveFiles({
    [FINGERPRINT_FILES[0]]: 'body{color:blue}/* other worktree build */',
    [FINGERPRINT_FILES[1]]: 'console.log("flux")',
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const localFp = collectArtifactFingerprint(local);
  const occupant = await describePortOccupant({ port, local: localFp });

  assert.equal(occupant.sameBytes, false, '只要有一个文件字节不同就必须判定为不一致');
  assert.notEqual(occupant.served.combined, localFp.combined);

  const report = formatOccupiedReport({ port, local: localFp, occupant });
  assert.match(report, /不一致/, '报告必须显式指出「看到的不是本仓代码」');
  assert.match(report, /conversation\.css/, '报告必须点名差异文件，便于定位');
  assert.match(report, new RegExp(`PORT=${port + 1}`), '必须给出改端口的可行出路');
});

test('占用者缺少某个产物 ⇒ 判定不一致，不得因缺文件而误报一致', async (t) => {
  const local = tempRepo({
    [FINGERPRINT_FILES[0]]: 'body{}',
    [FINGERPRINT_FILES[1]]: 'console.log(1)',
  });
  t.after(() => fs.rmSync(local, { recursive: true, force: true }));

  const { server, port } = await serveFiles({
    [FINGERPRINT_FILES[0]]: 'body{}',
    // 刻意不提供 index.js
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const occupant = await describePortOccupant({
    port,
    local: collectArtifactFingerprint(local),
  });

  assert.equal(occupant.sameBytes, false, '缺文件必须视为不一致（宁可误报也不给错误安心）');
  assert.equal(occupant.served.files[FINGERPRINT_FILES[1]].status, 404);
});

test('端口空闲时 describePortOccupant 不做任何请求', async () => {
  const probe = http.createServer((_req, res) => res.end());
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));

  let calls = 0;
  const fakeFetch = async () => {
    calls += 1;
    throw new Error('不应被调用');
  };
  const result = await describePortOccupant({ port, local: { files: {} }, fetchImpl: fakeFetch });

  assert.equal(result.occupied, false);
  assert.equal(calls, 0);
});

test('产物新鲜度：源码晚于产物 ⇒ stale=true；产物晚于源码 ⇒ stale=false', async (t) => {
  const staleRoot = tempRepo({
    'packages/ui/src/styles/conversation.css': 'body{}',
    [FINGERPRINT_FILES[0]]: 'body{}',
    [FINGERPRINT_FILES[1]]: 'console.log(1)',
  });
  t.after(() => fs.rmSync(staleRoot, { recursive: true, force: true }));

  const old = new Date('2020-01-01T00:00:00Z');
  const fresh = new Date('2030-01-01T00:00:00Z');
  for (const rel of FINGERPRINT_FILES) {
    fs.utimesSync(path.join(staleRoot, rel), old, old);
  }
  fs.utimesSync(path.join(staleRoot, 'packages/ui/src/styles/conversation.css'), fresh, fresh);

  const stale = assessDistFreshness(staleRoot);
  assert.equal(stale.stale, true, '源码比产物新时必须告警');
  assert.match(formatStaleReport(stale), /npm run build/, '告警必须给出可执行命令');

  const freshRoot = tempRepo({
    'packages/ui/src/styles/conversation.css': 'body{}',
    [FINGERPRINT_FILES[0]]: 'body{}',
    [FINGERPRINT_FILES[1]]: 'console.log(1)',
  });
  t.after(() => fs.rmSync(freshRoot, { recursive: true, force: true }));
  for (const rel of FINGERPRINT_FILES) {
    fs.utimesSync(path.join(freshRoot, rel), fresh, fresh);
  }
  fs.utimesSync(path.join(freshRoot, 'packages/ui/src/styles/conversation.css'), old, old);

  assert.equal(assessDistFreshness(freshRoot).stale, false, '产物新于源码时不得误报');
});

test('hashFileSync 与 collectArtifactFingerprint 口径一致', async (t) => {
  const root = tempRepo({ [FINGERPRINT_FILES[0]]: 'x'.repeat(1024) });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const abs = path.join(root, FINGERPRINT_FILES[0]);
  assert.equal(collectArtifactFingerprint(root).files[FINGERPRINT_FILES[0]].hash, hashFileSync(abs));
});
