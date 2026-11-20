/**
 * 头像尺寸形态守卫（renderBotAvatar 的 number | string 双形态）。
 *
 * 设计意图 (Why)：
 *   微轨站点卡随视口 clamp 动态缩放后，头像尺寸以 CSS 变量下发（字符串形态）。
 *   这条测试把两种形态的可观测输出钉死：
 *     1. 数字形态必须继续下发 width/height 属性 + style（既有调用点的契约）；
 *     2. 字符串形态必须只走 style，且白名单之外的值一律回退 36px ——
 *        size 会被原样插进 style 属性，不校验就是把属性注入面开给调用方。
 *
 * 防范的历史坑 (Pitfall)：
 *   放宽形参类型却不加校验时，`36px" onerror="alert(1)` 能直接闭合 style 属性并注入事件处理器。
 *
 * 约束与规则 (Rules)：
 *   断言基于真实渲染字符串，禁止只断言"函数被调用过"；负向用例必须断言注入片段整体消失。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBotAvatar } from '../dist/utils/botAvatar.js';

test('数字尺寸：同时下发 width/height 属性与 style 像素值（既有契约不变）', () => {
  const html = renderBotAvatar('alpha', 'Alpha', undefined, 36);
  assert.match(html, /width="36"/, '数字形态必须保留 width 属性：群聊拼图与在场指示器的守卫以属性为准');
  assert.match(html, /height="36"/, '数字形态必须保留 height 属性');
  assert.match(html, /style="width: 36px; height: 36px;/, 'style 里必须是 px 化后的同一数值');
});

test('字符串尺寸：只走 style，禁止写入 SVG 几何属性', () => {
  const html = renderBotAvatar('alpha', 'Alpha', undefined, 'var(--geo-station-avatar, 36px)');
  assert.match(html, /style="width: var\(--geo-station-avatar, 36px\); height: var\(--geo-station-avatar, 36px\)/);
  // 只看 <svg ...> 开标签：内部几何元素（如底衬 <rect width="36">）本来就有 width 属性，不能混为一谈。
  const svgTag = /<svg[^>]*>/.exec(html)?.[0] ?? '';
  assert.ok(svgTag, '必须渲染 <svg>');
  assert.equal(svgTag.includes('width='), false, 'SVG 几何属性不接受 CSS 变量，字符串形态不得下发 width 属性');
});

test('字符串尺寸白名单：只放行 CSS 变量与带单位数值', () => {
  for (const ok of ['12px', '1.5rem', '50%', '4vw', 'var(--a)', 'var(--a, 12px)']) {
    const html = renderBotAvatar('alpha', 'Alpha', undefined, ok);
    assert.ok(html.includes(`width: ${ok};`), `白名单形态必须原样下发：${ok}`);
  }
});

test('字符串尺寸：越界输入回退 36px 且不得形成属性注入', () => {
  const evil = '36px" onerror="alert(1)" data-x="';
  const html = renderBotAvatar('alpha', 'Alpha', undefined, evil);
  assert.equal(html.includes('onerror'), false, '非法尺寸不得把 onerror 注入进标签');
  assert.equal(html.includes('data-x'), false, '非法尺寸不得闭合 style 属性再追加自定义属性');
  assert.match(html, /style="width: 36px; height: 36px;/, '非法尺寸必须回退 36px');
});

test('数字尺寸：非有限值与 0 必须回退 36px，不得输出 NaN/0', () => {
  for (const bad of [0, -8, Number.NaN, Number.POSITIVE_INFINITY]) {
    const html = renderBotAvatar('alpha', 'Alpha', undefined, bad);
    assert.equal(html.includes('NaN'), false, `非法数字 ${String(bad)} 不得渗出 NaN`);
    assert.equal(html.includes('width: 0px'), false, `非法数字 ${String(bad)} 不得输出 0px`);
    assert.match(html, /style="width: 36px; height: 36px;/, `非法数字 ${String(bad)} 必须回退 36px`);
  }
});

test('真实头像 <img> 分支同样接受两种尺寸形态', () => {
  const numeric = renderBotAvatar('alpha', 'Alpha', 'data:image/png;base64,aa', 24);
  assert.match(numeric, /<img src="data:image\/png;base64,aa"/);
  assert.match(numeric, /width: 24px;\s*height: 24px;/);

  const vari = renderBotAvatar('alpha', 'Alpha', 'https://example.com/a.png', 'var(--geo-station-avatar, 36px)');
  assert.match(vari, /width: var\(--geo-station-avatar, 36px\);/);
  assert.equal(vari.includes('width="var'), false, '<img> 不得把 var() 塞进 width 属性');
});
