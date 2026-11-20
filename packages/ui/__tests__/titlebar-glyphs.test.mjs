/**
 * 顶栏字形守卫（titlebarGlyphs 七个导出的共用契约 + 镜像关系）。
 *
 * 设计意图 (Why)：
 *   这批字形是自绘 SVG，模块自述三条硬规则——16×16 网格、1.25px 线宽、只用 currentColor。
 *   三条规则若没有守卫，任何一次"顺手改粗/改色/改网格"都不会被门禁发现，
 *   顶栏会重新回到 lucide 混用 11/12/14px 的失重状态。
 *
 * 防范的历史坑 (Pitfall)：
 *   曾直接复用通用图标库默认尺寸与 2px 线宽，减号发胖、方块发虚、齿轮比面板图标粗，
 *   窗控三键与全局开关看起来像两套设计语言。
 *
 * 约束与规则 (Rules)：
 *   1. 逐字形断言几何与样式契约，不允许只断言"渲染出 svg"；
 *   2. 左右面板必须互为镜像（分栏线 6.5 / 9.5），否则折叠/检查舱按钮的语义会错位；
 *   3. 禁止出现裸色值（#hex / rgb()），换肤必须靠 currentColor 跟随。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CloseGlyph,
  MaximizeGlyph,
  MinimizeGlyph,
  PanelLeftGlyph,
  PanelRightGlyph,
  RestoreGlyph,
  SettingsGlyph,
} from '../dist/icons/titlebarGlyphs.js';

const GLYPHS = {
  PanelLeftGlyph,
  PanelRightGlyph,
  SettingsGlyph,
  MinimizeGlyph,
  MaximizeGlyph,
  RestoreGlyph,
  CloseGlyph,
};

const render = (Component, props = {}) => renderToStaticMarkup(React.createElement(Component, props));

test('七个字形共用契约：16×16 网格 / 1.25 线宽 / currentColor / 装饰性 aria', () => {
  for (const [name, Component] of Object.entries(GLYPHS)) {
    const html = render(Component);
    const svgTag = /<svg[^>]*>/.exec(html)?.[0] ?? '';
    assert.ok(svgTag, `${name} 必须渲染 <svg>`);
    assert.match(svgTag, /viewBox="0 0 16 16"/, `${name} 必须落在 16×16 网格`);
    assert.match(svgTag, /stroke-width="1\.25"/, `${name} 线宽必须恒为 1.25`);
    assert.match(svgTag, /stroke="currentColor"/, `${name} 必须用 currentColor 跟随换肤`);
    assert.match(svgTag, /fill="none"/, `${name} 不得实心填充`);
    assert.match(svgTag, /aria-hidden="true"/, `${name} 是装饰性字形，不得进入无障碍树`);
    assert.match(svgTag, /focusable="false"/, `${name} 不得被 IE/旧内核纳入 tab 序`);
    assert.equal(/[#]|rgb\(|hsl\(/.test(html), false, `${name} 禁止裸色值`);
  }
});

test('尺寸参数：缺省 16，自定义值同时写入 width/height', () => {
  for (const [name, Component] of Object.entries(GLYPHS)) {
    const def = /<svg[^>]*>/.exec(render(Component))?.[0] ?? '';
    assert.match(def, /width="16"/, `${name} 缺省宽度必须 16`);
    assert.match(def, /height="16"/, `${name} 缺省高度必须 16`);

    const large = /<svg[^>]*>/.exec(render(Component, { size: 24 }))?.[0] ?? '';
    assert.match(large, /width="24"/, `${name} 必须接受 size`);
    assert.match(large, /height="24"/, `${name} 宽高必须同步`);
    assert.match(large, /viewBox="0 0 16 16"/, `${name} 缩放不得改 viewBox（否则线宽会被拉扯）`);
  }
});

test('左右面板互为镜像：矩形相同、分栏线 6.5 ↔ 9.5', () => {
  const left = render(PanelLeftGlyph);
  const right = render(PanelRightGlyph);
  const rect = /<rect[^>]*>/.exec(left)?.[0] ?? '';
  assert.match(rect, /x="2\.5" y="3\.5" width="11" height="9"/, '面板矩形几何必须固定');
  assert.equal(rect, /<rect[^>]*>/.exec(right)?.[0], '左右面板矩形必须完全一致');
  assert.match(left, /M6\.5 3\.5v9/, '左面板分栏线必须在 6.5（靠左）');
  assert.match(right, /M9\.5 3\.5v9/, '右面板分栏线必须在 9.5（靠右）');
  assert.equal(left.includes('M9.5'), false, '左面板不得混入右分栏线');
  assert.equal(right.includes('M6.5'), false, '右面板不得混入左分栏线');
});

test('最小化与最大化光学等重：横线 9.6 宽 = 方块 9.6 见方', () => {
  assert.match(render(MinimizeGlyph), /M3\.2 8h9\.6/, '最小化必须是 9.6px 单横线');
  assert.match(render(MaximizeGlyph), /x="3\.2" y="3\.2" width="9\.6" height="9\.6"/, '最大化必须是 9.6px 见方细框');
  assert.match(render(MaximizeGlyph), /rx="1\.2"/, '最大化必须有 1.2 微圆角');
});

test('还原字形与关闭字形：还原是双框叠压，关闭与方块同外接尺寸', () => {
  const restore = render(RestoreGlyph);
  assert.match(restore, /x="5\.4" y="5\.4" width="8" height="8"/, '还原必须画前框');
  assert.match(restore, /M2\.6 10\.2V4\.6/, '还原必须画后框的左上折线');
  assert.equal((restore.match(/<rect/g) ?? []).length, 1, '还原只允许一个完整矩形，避免 16px 下糊成两块实心');

  assert.match(render(CloseGlyph), /M3\.6 3\.6l8\.8 8\.8M12\.4 3\.6l-8\.8 8\.8/, '关闭必须是 8.8px 对角十字');
});

test('设置字形：竖向双推子在滑块处断开轨道（不得一条线穿过去）', () => {
  const html = render(SettingsGlyph);
  assert.match(html, /M5\.5 2\.6v2\.1M5\.5 7\.3v6\.1/, '左推子轨道必须在滑块上下断开');
  assert.match(html, /M10\.5 2\.6v5\.1M10\.5 11\.3v2\.1/, '右推子轨道必须在滑块上下断开');
  assert.equal((html.match(/<circle/g) ?? []).length, 2, '必须恰好两颗滑块');
  assert.match(html, /cx="5\.5" cy="6" r="1\.35"/, '左滑块几何固定');
  assert.match(html, /cx="10\.5" cy="10" r="1\.35"/, '右滑块几何固定');
});
