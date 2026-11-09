/**
 * 左轨折叠态几何断言助手（跨包测试共用）。
 *
 * 设计意图 (Why)：
 *   折叠态总宽必须在"外层轨"与"微轨内层"两处完全同源，且必须补偿 1px 右边框。
 *   历史断言只做 markup.includes(...)，同一表达式在两处各出现一次，改回任一处断言仍绿，
 *   属于无法杀死变异的假测试。这里按 DOM 标签逐个提取 style 做精确比对。
 *
 * 约束与规则 (Rules)：
 *   1) 只依赖渲染产物字符串，不引入 DOM 环境；
 *   2) 不锁死 --geo-micro-rail 的 fallback 数值，只断言"引用变量 + 补偿 1px + 两处同源"；
 *   3) 断言失败信息必须指出是哪一条几何不变量被破坏。
 */
import assert from 'node:assert/strict';

/** 从单个标签字符串的 style 属性里读取指定 CSS 属性值。 */
function readStyleProp(tag, prop) {
  const style = tag.match(/style="([^"]*)"/)?.[1] ?? '';
  const decl = style
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${prop}:`));
  return decl ? decl.slice(prop.length + 1).trim() : undefined;
}

/**
 * 断言折叠态左轨几何：外层轨宽与微轨内层宽精确同源，且补偿 1px 右边框。
 *
 * @param {string} markup 左轨渲染产物
 */
export function assertCollapsedRailGeometry(markup) {
  const aside = markup.match(/<aside[^>]*data-testid="react-left-rail"[^>]*>/)?.[0];
  const station = markup.match(/<div id="flux-station-rail"[^>]*>/)?.[0];
  assert.ok(aside, '折叠态必须渲染外层轨 <aside data-testid="react-left-rail">');
  assert.ok(station, '折叠态必须常驻微轨 #flux-station-rail');

  const outerWidth = readStyleProp(aside, 'width');
  const innerWidth = readStyleProp(station, 'width');
  assert.ok(outerWidth, '外层轨必须显式声明 width');
  assert.ok(innerWidth, '微轨内层必须显式声明 width');

  assert.equal(innerWidth, outerWidth, '微轨内层宽度必须与外层轨宽完全同源');
  assert.match(outerWidth, /--geo-micro-rail/, '折叠态总宽必须引用微轨几何变量，禁止写死像素');
  assert.match(outerWidth, /\+ 1px\)$/, '折叠态总宽必须补偿 1px 右边框，否则内容区被 border-box 吃掉');

  const flex = readStyleProp(aside, 'flex');
  assert.equal(flex?.replace(/^0 0 /, ''), outerWidth, '折叠态 flex-basis 必须与 width 完全一致');
  assert.equal(readStyleProp(aside, 'min-width'), outerWidth, '折叠态 min-width 必须与 width 完全一致');
  assert.equal(readStyleProp(aside, 'max-width'), outerWidth, '折叠态 max-width 必须与 width 完全一致');
}
