/**
 * 顶栏 / 微轨 / 移动端检查舱 的几何单真值守卫。
 *
 * 设计意图 (Why)：
 *   顶栏从"42px 含边框总高"改为"42px 内容高 + 1px 下边框"后，所有依赖顶栏高度的
 *   fixed 定位与移动端注入 CSS 必须同步引用同一表达式。这类改动没有任何行为测试能感知，
 *   只能用静态几何断言把"同源"钉死。
 *
 * 防范的历史坑 (Pitfall)：
 *   1) 历史只改 .flux-titlebar 而漏掉 responsive 的 top，出现 1px 缝隙；
 *   2) 字符串版 Titlebar 内联 42px 覆盖 class 规则，主页面 43px、harness 42px 双真值；
 *   3) 媒体查询里写了永不命中的 #flux-inspection-pod（真实 id 是 flux-inspector-pod）。
 *
 * 约束与规则 (Rules)：
 *   断言基于字符级表达式比对，禁止放宽为 includes('43px') 之类的数值近似。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 顶栏外围总高的唯一表达式（内容高 + 1px 下边框）。 */
const TITLEBAR_BORDERED = 'calc(var(--geo-titlebar) + 1px';

test('styles.css：顶栏 content-box 高度与 1px 边框补偿必须同源', () => {
  const css = read('packages/desktop/src/renderer/styles.css');

  assert.ok(css.includes(`${TITLEBAR_BORDERED} + env(safe-area-inset-top, 0px))`), '顶栏 height 必须使用内容高 + 1px 的表达式');
  assert.equal(
    (css.match(/(?<![-\w])height: calc\(var\(--geo-titlebar\) \+ 1px \+ env\(safe-area-inset-top, 0px\)\);/g) ?? []).length,
    1,
    '.flux-titlebar 的 height 必须且只能有一处定义',
  );
  assert.ok(/min-height: calc\(var\(--geo-titlebar\) \+ 1px \+ env\(safe-area-inset-top, 0px\)\);/.test(css), 'min-height 必须与 height 完全同源');

  assert.equal(css.includes('height: calc(42px + env(safe-area-inset-top, 0px));'), false, '顶栏不得残留裸 42px 旧写法');
  assert.equal(css.includes('min-height: 42px;'), false, 'min-height 不得残留裸 42px 旧写法');
});

test('styles.css：所有依赖顶栏高度的 fixed 定位必须同步补偿 1px', () => {
  const css = read('packages/desktop/src/renderer/styles.css');

  const tops = css.match(/top: calc\([^;]*\);/g) ?? [];
  const titlebarTops = tops.filter((line) => line.includes('--geo-titlebar'));
  assert.ok(titlebarTops.length >= 2, '移动端左轨与检查舱的 top 都必须引用 --geo-titlebar');
  for (const line of titlebarTops) {
    assert.ok(line.includes('+ 1px'), `依赖顶栏的定位必须补偿 1px 边框：${line}`);
  }

  assert.equal(tops.some((line) => /calc\(42px/.test(line)), false, '不得残留以裸 42px 为基准的顶栏定位');
});

test('styles.css：移动端检查舱选择器必须命中真实 DOM id', () => {
  const css = read('packages/desktop/src/renderer/styles.css');
  const inspectionPod = read('packages/ui/src/components/InspectionPod/InspectionPod.ts');
  const renderer = read('packages/desktop/src/renderer/index.ts');

  // 真实 id 以组件模板与渲染层查询为准，二者必须一致。
  assert.ok(inspectionPod.includes('flux-inspector-pod'), '组件模板必须使用 flux-inspector-pod');
  assert.ok(renderer.includes("querySelector('#flux-inspector-pod')"), '渲染层必须按 flux-inspector-pod 查询');

  assert.equal(css.includes('#flux-inspection-pod'), false, 'CSS 不得残留永不命中的 #flux-inspection-pod 死选择器');
  assert.equal(css.includes('.flux-inspection-pod'), false, 'CSS 不得残留永不命中的 .flux-inspection-pod 死选择器');
  assert.ok(css.includes('#flux-inspector-pod'), 'CSS 必须存在检查舱的实名选择器');
});

test('styles.css：移动端检查舱 Sheet 必须真实生效（非死规则）', () => {
  const css = read('packages/desktop/src/renderer/styles.css');
  const blocks = [...css.matchAll(/#flux-inspector-pod,\s*\.flux-inspector-pod\s*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(blocks.length > 0, '必须存在检查舱实名规则块（#flux-inspector-pod, .flux-inspector-pod）');

  const sheet = blocks.find((b) => b.includes('position: fixed'));
  assert.ok(sheet, '移动端检查舱必须收敛为 fixed 浮动 Sheet');
  assert.ok(sheet.includes('top: calc(var(--geo-titlebar) + 1px'), 'Sheet 顶端必须与顶栏总高严丝合缝');
  assert.ok(sheet.includes('z-index: 110'), 'Sheet 必须覆盖对话区并保留既有层级');
});

test('微轨真值：组件 fallback 必须与 styles.css 的 :root 定义完全一致', () => {
  const css = read('packages/desktop/src/renderer/styles.css');
  const rail = read('packages/ui/src/components-react/LeftRail.tsx');

  const defined = /--geo-micro-rail:\s*([^;]+);/.exec(css)?.[1].trim();
  assert.ok(defined, ':root 必须定义 --geo-micro-rail');
  assert.ok(
    rail.includes(`calc(var(--geo-micro-rail, ${defined}) + 1px)`),
    `LeftRail 的 fallback 必须与 :root 真值「${defined}」逐字一致，否则变量缺失时几何静默漂移`,
  );
  assert.equal(rail.includes('--geo-micro-rail, 52px'), false, 'LeftRail 不得残留 52px 旧 fallback');
});

test('展开态真值：LeftRail 的 --rail-w-left fallback 必须等于 LEFT_RAIL_WIDTH.defaultValue', () => {
  const rail = read('packages/ui/src/components-react/LeftRail.tsx');
  const renderer = read('packages/desktop/src/renderer/index.ts');

  const defaultValue = /LEFT_RAIL_WIDTH\s*=\s*\{[^}]*defaultValue:\s*(\d+)/.exec(renderer)?.[1];
  assert.ok(defaultValue, 'renderer 必须保留 LEFT_RAIL_WIDTH 单一真值源');
  assert.ok(
    rail.includes(`var(--rail-w-left, ${defaultValue}px)`),
    `展开态 fallback 必须与 LEFT_RAIL_WIDTH.defaultValue（${defaultValue}px）一致`,
  );
});

test('移动端注入 CSS：顶栏高度与桌面端同源', () => {
  const mjs = read('packages/mobile/scripts/prepare-assets.mjs');
  assert.match(
    mjs,
    /height: calc\(var\(--geo-titlebar, 42px\) \+ 1px \+ env\(safe-area-inset-top, 0px\)\) !important;/,
    'Capacitor 注入的顶栏高度必须与桌面端同为「内容高 + 1px」',
  );
});

test('字符串版 Titlebar 内联高度必须与 class 规则同源（防止双真值）', () => {
  const ts = read('packages/ui/src/components/Titlebar/Titlebar.ts');

  assert.ok(ts.includes('height: calc(var(--geo-titlebar, 42px) + 1px + env(safe-area-inset-top, 0px));'), '内联 height 必须补偿 1px');
  assert.ok(ts.includes('min-height: calc(var(--geo-titlebar, 42px) + 1px + env(safe-area-inset-top, 0px));'), '内联 min-height 必须同源');
  assert.equal(ts.includes('height: calc(42px + env(safe-area-inset-top, 0px));'), false, '内联高度不得残留裸 42px');
  assert.equal(ts.includes('min-height: 42px;'), false, '内联 min-height 不得残留裸 42px');
});
