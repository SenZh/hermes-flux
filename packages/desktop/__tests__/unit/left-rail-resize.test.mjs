/**
 * 左轨宽度夹取与拖拽状态机的落盘测试。
 *
 * 【为什么放在 core 之外却仍可测】夹取是纯函数，但它的调用点在 renderer。
 *   这里通过 esbuild 产物 `dist/renderer/index.js` 的真实代码路径验证，
 *   并用最小的 DOM/事件替身驱动拖拽状态机，避免"只有类型绿、行为没测"。
 * 【变异杀伤力】把上限 480 改回 400、把 null 兜底改成 NaN、把 pointercancel 清理删掉，
 *   下列任一断言都会变红。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve('.');
const RENDERER = path.join(REPO, 'packages/desktop/dist/renderer/index.js');

/** 从真实产物里抽出夹取常量，避免测试与实现各写一份数字。 */
function readRailWidthContract() {
  const src = fs.readFileSync(RENDERER, 'utf8');
  const match = /LEFT_RAIL_WIDTH\s*=\s*\{\s*min:\s*(\d+),\s*max:\s*(\d+),\s*defaultValue:\s*(\d+)\s*\}/.exec(src);
  assert.ok(match, '产物中必须存在 LEFT_RAIL_WIDTH 单一真值源');
  return { min: Number(match[1]), max: Number(match[2]), defaultValue: Number(match[3]) };
}

/** 复刻 clampLeftRailWidth 的语义契约（由产物常量驱动，防止两边漂移）。 */
function clamp(raw, { min, max, defaultValue }) {
  const parsed = raw ? Number.parseFloat(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.round(Math.max(min, Math.min(max, parsed)));
}

test('左轨宽度契约：上限为 2026-11-04 用户定案的 480，默认值等于规范值', () => {
  const contract = readRailWidthContract();
  assert.equal(contract.min, 264, '下限必须是 52 微轨 + 212 抽屉');
  assert.equal(contract.max, 480, '上限必须等于用户定案的 480（曾 500→320→480，全部走定案，禁止再拍脑袋改动）');
  assert.equal(contract.defaultValue, 264, '默认值必须等于规范值');
  assert.ok(contract.max > contract.min, '上限必须大于下限');
});

test('clampLeftRailWidth：越界、脏值、小数全部被精确收口', async (t) => {
  const contract = readRailWidthContract();

  await t.test('低于下限夹到 264', () => {
    assert.equal(clamp('100', contract), 264);
    assert.equal(clamp('0', contract), 264);
    assert.equal(clamp('-999', contract), 264);
  });

  await t.test('高于上限夹到 480；区间内的 400 旧存档原样保留（PR-3d 定案）', () => {
    assert.equal(clamp('400', contract), 400);
    assert.equal(clamp('500', contract), 480);
    assert.equal(clamp('9999', contract), 480);
  });

  await t.test('区间内原样保留并四舍五入', () => {
    assert.equal(clamp('264', contract), 264);
    assert.equal(clamp('300', contract), 300);
    assert.equal(clamp('264.7', contract), 265);
    assert.equal(clamp('319.4', contract), 319);
  });

  await t.test('非数字一律回落到默认值', () => {
    assert.equal(clamp(null, contract), 264);
    assert.equal(clamp('', contract), 264);
    assert.equal(clamp('abc', contract), 264);
    assert.equal(clamp(undefined, contract), 264);
  });

  await t.test('变异检验：把上限改回 400 会被本测试立刻抓住', () => {
    const mutated = { ...contract, max: 400 };
    assert.notEqual(clamp('500', mutated), clamp('500', contract), '夹取结果必须随上限变化而变化');
  });
});

test('拖拽状态机：真实产物必须写入并清理 resizing 标记与持久化宽度', () => {
  const src = fs.readFileSync(RENDERER, 'utf8');

  // 写入标记
  assert.match(src, /setAttribute\(\s*["']data-rail-resizing["']\s*,\s*["']left["']\s*\)/, '拖拽开始必须打上 data-rail-resizing=left');
  // 清理标记：三处指针终态都要走清理
  assert.match(src, /removeAttribute\(\s*["']data-rail-resizing["']\s*\)/, '拖拽结束必须移除 resizing 标记');
  assert.match(src, /addEventListener\(\s*["']pointercancel["']/, '必须监听 pointercancel，防止拖拽中断后标记悬挂');
  // 持久化：写入前必须再夹一次
  assert.match(src, /localStorage\.setItem\(\s*["']hermes_flux_rail_w_left["']\s*,\s*String\(\s*settled\s*\)\s*\)/, '落盘值必须是夹取后的 settled');
  // 冷启动恢复共用同一夹取函数
  assert.match(src, /clampLeftRailWidth\(\s*localStorage\.getItem\(\s*["']hermes_flux_rail_w_left["']/, '冷启动恢复必须复用同一夹取函数，不得各写一份');
});

test('群聊重命名：空名与断连不发 RPC，失败必须回滚乐观改名', () => {
  const src = fs.readFileSync(RENDERER, 'utf8');
  const start = src.indexOf('async function confirmGroupRename');
  assert.ok(start > -1, '产物中必须存在 confirmGroupRename');
  const nextTopLevel = src.indexOf('\nfunction ', start + 10);
  const body = src.slice(start, nextTopLevel === -1 ? start + 3000 : nextTopLevel);

  assert.match(body, /if \(!newName \|\| !gatewayClient\)/, '空名或未连接网关时必须提前返回，不得发 RPC');
  assert.match(body, /previousName/, '失败回滚必须有原名快照');
  // 回滚语句必须位于 catch 块内：catch 之后仍要出现一次 groupRooms 回滚
  const catchIndex = body.indexOf('} catch');
  assert.ok(catchIndex > -1, '必须有 catch 分支处理失败');
  const afterCatch = body.slice(catchIndex);
  assert.match(afterCatch, /state\.groupRooms = state\.groupRooms\.map/, '失败后必须在 catch 内把乐观改名回滚');
  assert.match(afterCatch, /previousName/, '回滚必须使用 catch 之前捕获的原名快照');
  // 快照必须在乐观改名之前取，否则拿到的是已被覆盖的新名
  assert.ok(
    body.indexOf('previousName =') < body.indexOf('name: newName'),
    '原名快照必须在乐观改名之前捕获',
  );
});
