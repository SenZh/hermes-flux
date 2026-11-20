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
 *   2) 媒体查询里写了永不命中的 #flux-inspection-pod（真实 id 是 flux-inspector-pod）。
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
  const renderCoord = read('packages/desktop/src/renderer/renderCoordinator.ts');
  const renderer = read('packages/desktop/src/renderer/index.ts') + '\n' + renderCoord;

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
  const bootstrap = read('packages/desktop/src/renderer/bootstrap/appBootstrap.ts');

  const defaultValue = /LEFT_RAIL_WIDTH\s*=\s*\{[^}]*defaultValue:\s*(\d+)/.exec(bootstrap)?.[1];
  assert.ok(defaultValue, 'appBootstrap 必须保留 LEFT_RAIL_WIDTH 单一真值源');
  assert.match(
    renderer,
    /LEFT_RAIL_WIDTH[\s\S]*from '\.\/bootstrap\/appBootstrap\.js'/,
    'renderer 必须从 appBootstrap 导入该真值，禁止本地重复定义',
  );
  assert.ok(
    rail.includes(`var(--rail-w-left, ${defaultValue}px)`),
    `展开态 fallback 必须与 LEFT_RAIL_WIDTH.defaultValue（${defaultValue}px）一致`,
  );
});

test('移动端注入 CSS：顶栏高度与桌面端同源', () => {
  const mjs = read('packages/mobile/scripts/prepare-assets.mjs');
  const css = read('packages/desktop/src/renderer/styles.css');
  // 从 :root 真值派生，禁止在测试里硬编码高度——否则调高/调矮会制造假失败
  const rootHeight = /--geo-titlebar:\s*(\d+)px/.exec(css)?.[1];
  assert.ok(rootHeight, ':root 必须定义 --geo-titlebar');
  assert.ok(
    mjs.includes(`height: calc(var(--geo-titlebar, ${rootHeight}px) + 1px + env(safe-area-inset-top, 0px)) !important;`),
    `Capacitor 注入的顶栏高度必须与桌面端同为「内容高 + 1px」，且 fallback 等于 :root 真值 ${rootHeight}px`,
  );
});

test('顶栏左段：展开态宽度必须与左栏共用 --rail-w-left，禁止 flex:1 弹性占满', () => {
  const css = read('packages/desktop/src/renderer/styles.css');
  const block = /\.titlebar-left\s*\{([^}]*)\}/.exec(css)?.[1];
  assert.ok(block, '.titlebar-left 规则块必须存在');

  // 设计意图：左段与左栏共用同一 Token，拖宽左栏时两者逐帧同步，右边界永不脱钩。
  assert.match(block, /flex:\s*0 0 var\(--rail-w-left,\s*\d+px\)/, '展开态 flex 必须引用 --rail-w-left');
  assert.doesNotMatch(block, /flex:\s*1\b/, '展开态禁止用 flex:1 —— 会让左段宽度与左栏脱钩');
  assert.ok(block.includes('transition'), '左段必须声明过渡，否则折叠时与左栏 200ms 动画撕裂');
});

test('顶栏左段：折叠态必须与左栏竖线对齐，且始终放得下 ☰', () => {
  const css = read('packages/desktop/src/renderer/styles.css');

  const collapsed = css.match(/\.flux-titlebar\[data-left-rail-collapsed="true"\]\s*\.titlebar-left\s*\{([^}]*)\}/)?.[1];
  assert.ok(collapsed, '折叠态选择器必须存在');
  assert.doesNotMatch(collapsed, /flex:\s*0 0 auto/, '折叠态禁止 auto —— 264px 到 auto 不可插值，会与左栏过渡撕裂');
  // 折叠态要同时满足：① 不窄于内容容量 ② 尽量等于左栏宽度（竖线连续）
  assert.match(collapsed, /max\(/, '折叠态必须用 max() 兼顾「放得下 ☰」与「与左栏对齐」');
  assert.match(collapsed, /--geo-micro-rail/, '折叠态必须引用微轨宽度，否则竖线与左栏错位');
  assert.match(collapsed, /--geo-titlebar-left-content/, '折叠态必须保住内容容量，否则 ☰ 被 padding 钳出');
});

test('顶栏底边横线不得横穿左栏上方（左栏必须视觉整体、顶天立地）', () => {
  const css = read('packages/desktop/src/renderer/styles.css');
  const titlebar = /\.flux-titlebar\s*\{([^}]*)\}/.exec(css)?.[1];
  assert.ok(titlebar, '.flux-titlebar 规则块必须存在');

  // 通栏 border-bottom 会把左栏拦腰截断——必须透明，可见横线改由 ::after 从左栏右边界起画
  assert.match(titlebar, /border-bottom:\s*1px solid transparent/, '顶栏 border-bottom 必须透明（保留 1px 仅凑齐外围总高 33px）');

  const after = /\.flux-titlebar::after\s*\{([^}]*)\}/.exec(css)?.[1];
  assert.ok(after, '必须用 ::after 单独绘制顶栏底边横线');
  assert.match(after, /left:\s*var\(--rail-w-left/, '::after 必须从左栏右边界起画，否则横线穿进左栏');
  // 用户 2026-11-20 裁决：这条横线要"再细一点"——1px 已是物理下限，只能由 --border-subtle 派生降低对比度。
  // 比例必须钉死 60%：写成 \d+% 会让"改回 100%"（等于撤销用户裁决）依然全绿。
  assert.match(
    after,
    /background:\s*color-mix\(in srgb, var\(--border-subtle\) 60%, transparent\)/,
    '::after 必须由 --border-subtle 派生且固定 60% 混透明（禁止裸色值，也禁止回退到 100%）',
  );

  // 左栏竖线必须从顶栏顶端就存在（titlebar-left 的 border-right），才能与下方左栏接成一条
  const leftSeg = /\.titlebar-left\s*\{([^}]*)\}/.exec(css)?.[1];
  // 颜色经 --titlebar-divider 单一真值转发（跨底边 1px 补丁与 border-right 共用），
  // 因此这里断言的是"经变量转发 + 变量默认取 --border-subtle"，而不是字面色值。
  assert.match(leftSeg, /border-right:\s*1px solid var\(--titlebar-divider\)/, '顶栏左段必须有 border-right（经 --titlebar-divider 转发），使竖线从窗口顶端贯穿');
  assert.match(leftSeg, /--titlebar-divider:\s*var\(--border-subtle\)/, '--titlebar-divider 默认必须回落到 --border-subtle');
});

test('顶栏左段：content 与 inset 两个 Token 必须在 :root 各有唯一定义', () => {
  const css = read('packages/desktop/src/renderer/styles.css');
  for (const name of ['--geo-titlebar-left-content', '--geo-titlebar-left-inset']) {
    const hits = css.match(new RegExp(`${name}:\\s*[^;]+;`, 'g')) ?? [];
    // inset 允许在 :root 定义一次 + macOS 平台覆盖一次
    const expected = name === '--geo-titlebar-left-inset' ? 2 : 1;
    assert.equal(hits.length, expected, `${name} 定义次数应为 ${expected}，实际 ${hits.length}`);
  }
});

test('顶栏左段：移动端必须复位为 auto，否则 390px 视口右侧按钮溢出', () => {
  const css = read('packages/desktop/src/renderer/styles.css');
  const start = css.indexOf('@media (max-width: 768px)');
  assert.ok(start > 0, '移动端媒体查询块必须存在');
  const block = css.slice(start);
  assert.match(block, /\.titlebar-left\s*\{[^}]*flex:\s*0 0 auto/, '移动端必须把左段复位为 auto（左栏是浮层不占宽）');
});

test('检查舱全屏：定位基准必须是 .flux-main-block，不得覆盖左栏', () => {
  const css = read('packages/desktop/src/renderer/styles.css');
  const coord = read('packages/desktop/src/renderer/renderCoordinator.ts');

  assert.ok(css.includes('.flux-main-block'), '必须定义 .flux-main-block 容器');
  assert.match(css, /\.flux-main-block\s*\{[^}]*position:\s*relative/, '.flux-main-block 必须为 relative，作为全屏定位基准');
  assert.ok(coord.includes('class="flux-main-block"'), '骨架必须渲染 .flux-main-block 容器');
  // 左栏必须在 flux-main-block 之外，否则全屏仍会盖住它
  const mainBlockIdx = coord.indexOf('class="flux-main-block"');
  const railHostIdx = coord.indexOf('id="react-leftrail-host"');
  assert.ok(railHostIdx > 0 && railHostIdx < mainBlockIdx, '左栏宿主必须位于 .flux-main-block 之前（即在其外部）');
});

test('顶栏左段：macOS 交通灯让位值必须与 openchamber 参照真值一致', () => {
  const css = read('packages/desktop/src/renderer/styles.css');

  // 参照真值：openchamber Header.tsx:1051 macOS 桌面非全屏时硬编码 88px。
  // 该实现未使用 getWindowButtonPosition()——Electron 该 API 只回显传入坐标，不返回按钮组宽度。
  const token = css.match(/--geo-titlebar-left-inset-macos:\s*(\d+)px/);
  assert.ok(token, ':root 必须定义 --geo-titlebar-left-inset-macos');
  assert.equal(token[1], '88', 'macOS 让位值必须为 88px（对齐 openchamber 参照实现）');

  const rule = css.match(/html\[data-platform="macos"\]\s*\{([^}]*)\}/)?.[1];
  assert.ok(rule, '必须存在 macOS 平台规则');
  assert.match(rule, /--geo-titlebar-left-inset:\s*var\(--geo-titlebar-left-inset-macos/, 'macOS 必须把 inset Token 覆盖为 88px，禁止直接写 padding 字面量');
});

test('标题居中：必须消费检查舱「实际占位」而非 --rail-w-right 变量名', () => {
  const css = read('packages/desktop/src/renderer/styles.css');
  const block = /\.titlebar-center\s*\{([^}]*)\}/.exec(css)?.[1];
  assert.ok(block, '.titlebar-center 规则块必须存在');

  // 出厂默认 inspectorCollapsed: true，此时右舱 display:none、flex-basis:0，
  // 但 --rail-w-right 恒为 420（appBootstrap 无条件写入），若直接引用它，
  // 默认界面标题恒定偏左 210px。
  assert.doesNotMatch(
    block,
    /left:[^;]*--rail-w-right/,
    '标题 left 禁止直接引用 --rail-w-right（该变量不随折叠归零，出厂默认即偏 210px）',
  );
  assert.match(block, /left:[^;]*--geo-titlebar-right-offset/, '标题 left 必须引用由折叠态驱动的 --geo-titlebar-right-offset');

  // 折叠态必须提供归零路径
  assert.match(
    css,
    /\.flux-titlebar\[data-inspector-collapsed="false"\]\s*\{[^}]*--geo-titlebar-right-offset:\s*var\(--rail-w-right/,
    '必须存在「检查舱展开时才让位」的条件规则',
  );
  assert.match(
    css,
    /\.flux-titlebar\s*\{[^}]*--geo-titlebar-right-offset:\s*0px/,
    '默认（检查舱折叠）必须把右让位归零',
  );
});

test('标题居中：必须算得出「对话区中心」的正确像素，而非仅引用正确变量名', () => {
  const css = read('packages/desktop/src/renderer/styles.css');
  const block = /\.titlebar-center\s*\{([^}]*)\}/.exec(css)?.[1];
  assert.ok(block);
  const leftDecl = /left:\s*([^;]+);/.exec(block)?.[1]?.trim();
  assert.ok(leftDecl, '.titlebar-center 必须有 left 声明');

  // 【变异杀伤】只断言「引用了 --geo-titlebar-right-offset」是不够的：
  // left: calc(100% - var(--geo-titlebar-right-offset) / 2) 同样引用了该变量，
  // 但完全忽略左栏宽度，默认态标题会贴到窗口右缘。必须校验算术结构本身。
  assert.match(
    leftDecl,
    /^calc\(\s*\(\s*var\(--rail-w-left[^)]*\)\s*\+\s*100%\s*-\s*var\(--geo-titlebar-right-offset[^)]*\)\s*\)\s*\/\s*2\s*\)$/,
    `标题 left 必须是 ((左栏宽 + 100% - 右让位) / 2)，实际为：${leftDecl}`,
  );

  // 数值复算：把 CSS 表达式按真实取值代入，断言等于对话区中心
  const computeCenter = (railW, total, offset) => (railW + total - offset) / 2;
  // 出厂默认：左栏 264、检查舱折叠(offset=0)、视口 1440 → 对话区 [264,1440] 中心
  assert.equal(computeCenter(264, 1440, 0), 852, '默认态对话区中心必须是 852');
  // 检查舱展开：对话区 [264,1020] 中心
  assert.equal(computeCenter(264, 1440, 420), 642, '检查舱展开时必须左移到 642（用户裁决的 78px）');
  // 左栏折叠：微轨 clamp 下限 58 + 1px 边框 = 59
  assert.equal(computeCenter(59, 1440, 0), 749.5, '左栏折叠态中心必须是 749.5');

  // 折叠态分支也必须用同构算术（微轨 + 1px 补偿 + 100% - 右让位）/ 2
  const collapsed = /\.flux-titlebar\[data-left-rail-collapsed="true"\]\s*\.titlebar-center\s*\{([^}]*)\}/.exec(css)?.[1];
  assert.ok(collapsed, '必须存在折叠态标题规则');
  const collapsedLeft = /left:\s*([^;]+);/.exec(collapsed)?.[1]?.trim();
  assert.match(collapsedLeft, /\+ 1px/, '折叠态必须补偿左栏 1px 右边框（P-023）');
  assert.match(collapsedLeft, /--geo-titlebar-right-offset/, '折叠态同样必须用右让位变量');
});

test('拖拽左右栏时必须关闭标题过渡，否则标题弹簧追帧与栏边界错位', () => {
  const css = read('packages/desktop/src/renderer/styles.css');
  assert.match(
    css,
    /html\[data-rail-resizing\][\s\S]{0,400}?\.titlebar-center/,
    'html[data-rail-resizing] 的免过渡清单必须包含 .titlebar-center',
  );
});

test('拖拽高亮必须贯穿顶栏（用户 2026-11-20：蓝线没到顶）', () => {
  const css = read('packages/desktop/src/renderer/styles.css');

  // 把手是左栏子元素，高亮天然止于顶栏下沿；必须由顶栏左段同色续接，否则出现"断头蓝线"。
  assert.match(
    css,
    /html:not\(\[data-rail-resizing="left"\]\):has\(\.rail-resize-handle\[data-rail-handle="left"\]:hover\) \.titlebar-left/,
    'hover 态必须在顶栏左段续接把手高亮（且与拖拽态互斥）',
  );
  const dragRule = /html\[data-rail-resizing="left"\] \.titlebar-left\s*\{([^}]*)\}/.exec(css)?.[1];
  assert.ok(dragRule, '拖拽态必须声明 html[data-rail-resizing="left"] .titlebar-left 续接规则');
  assert.match(dragRule, /--titlebar-divider:\s*color-mix\(in srgb, var\(--primary\)/, '续接色必须由 --primary 派生，禁止硬编码蓝');
  // 高亮必须落在左栏真实分隔线（#flux-left-rail 的 border-right）上，
  // 而不是把手自身那 1px 边框——两者相距 1px，会渲染成错位双线（用户实测）。
  assert.match(
    css,
    /html:not\(\[data-rail-resizing="left"\]\):has\(\.rail-resize-handle\[data-rail-handle="left"\]:hover\) #flux-left-rail[^{]*\{[^}]*border-right-color/,
    'hover 态必须着色左栏真实分隔线，而不是把手自身的边框',
  );
  assert.match(
    css,
    /\.rail-resize-handle\[data-rail-handle="left"\]:active\s*\{[^}]*border-color:\s*transparent/,
    '左把手自身边框必须恒透明，避免与分隔线形成双线',
  );
  assert.equal(
    /html\[data-rail-resizing\] \.titlebar-left\s*\{/.test(css),
    false,
    '续接规则禁止用无侧别的 data-rail-resizing，否则拖右舱时左侧误亮',
  );
  // 拖拽加深不得被 hover 规则压制：hover 分支必须带 :not([data-rail-resizing="left"])。
  // 否则 :has() 的高特异性会让 45% 恒久覆盖 65%，"按住了但没变深"。
  const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const hoverRules = [...cssNoComments.matchAll(/html:([^{}]*:has\(\.rail-resize-handle\[data-rail-handle="left"\]):hover\)[^{]*\{/g)];
  assert.ok(hoverRules.length >= 2, 'hover 续接规则必须同时覆盖左栏与顶栏左段');
  for (const rule of hoverRules) {
    assert.ok(
      rule[1].startsWith('not([data-rail-resizing="left"])'),
      `hover 续接规则必须与拖拽态互斥，实际前缀：${rule[1].slice(0, 40)}`,
    );
  }
  // 键盘聚焦把手时同样要续接：把手自身边框三态恒透明，只补 :hover 会让键盘用户失去这条线。
  assert.match(
    css,
    /html:not\(\[data-rail-resizing="left"\]\):has\(\.rail-resize-handle\[data-rail-handle="left"\]:focus-visible\) \.titlebar-left\s*\{[^}]*--titlebar-divider/,
    'focus-visible 态必须在顶栏左段续接把手高亮（键盘可达性）',
  );
  // 跨底边 1px 补丁：.titlebar-left 的 100% 只覆盖内容盒，底部 1px 属顶栏透明边框，
  // 竖线会在 y=32 断口。必须有同色 1px 方块焊接，且颜色读同一变量。
  const seam = /\.titlebar-left::after\s*\{([^}]*)\}/.exec(css)?.[1];
  assert.ok(seam, '必须存在跨底边接缝补丁 .titlebar-left::after');
  assert.match(seam, /bottom:\s*-1px/, '接缝补丁必须下探 1px 越过顶栏透明底边框');
  assert.match(seam, /background:\s*var\(--titlebar-divider\)/, '接缝补丁必须读 --titlebar-divider，禁止另写色值');
});

test('折叠态：设置键必须隐藏，保住「左栏单线顶天立地」', () => {
  const css = read('packages/desktop/src/renderer/styles.css');
  const rule = /\.flux-titlebar\[data-left-rail-collapsed="true"\] #btn-open-settings\s*\{([^}]*)\}/.exec(css)?.[1];
  assert.ok(rule, '折叠态必须声明 #btn-open-settings 的隐藏规则');
  assert.match(rule, /display:\s*none/, '折叠态微轨放不下两个 28px 热区，设置键必须隐藏而非压过竖线');
});

test('微轨站点卡与头像必须随微轨宽度等比缩放（禁止写回死像素）', () => {
  const css = read('packages/desktop/src/renderer/styles.css');
  const rail = read('packages/ui/src/components-react/LeftRail.tsx');

  // 数值链路：clamp(下界, 微轨宽 × 系数, 上界) —— 上下界次序写反会让 clamp 恒取上界，
  // 只断言"引用了 --geo-micro-rail"抓不到这种变异，必须把三段拆开核对。
  const card = /--geo-station-card:\s*clamp\((\d+(?:\.\d+)?)px,\s*calc\(var\(--geo-micro-rail[^)]*\)\s*\*\s*([\d.]+)\),\s*(\d+(?:\.\d+)?)px\)/.exec(css);
  assert.ok(card, '站点卡必须是 clamp(下界px, calc(--geo-micro-rail * 系数), 上界px) 形态');
  const lower = Number(card[1]);
  const factor = Number(card[2]);
  const upper = Number(card[3]);
  assert.ok(lower > 0, '站点卡下界必须为正，否则极窄视口会塌成 0');
  assert.ok(lower < upper, `站点卡下界必须小于上界，实际 ${lower} / ${upper}`);
  assert.ok(factor > 0 && factor < 1, '站点卡系数必须落在 (0,1)，否则会撑破微轨');
  // 微轨下限（clamp 下界 58px）代入后必须仍 ≥ 28px 触控下限且 ≤ 上界
  const microLower = Number(/--geo-micro-rail:\s*clamp\((\d+(?:\.\d+)?)px/.exec(css)?.[1]);
  assert.ok(microLower >= 56, '微轨 clamp 下界必须存在且合理');
  const atMin = Math.min(Math.max(microLower * factor, lower), upper);
  assert.ok(atMin >= 28, `微轨最窄时站点卡 ${atMin}px 不得低于 28px 触控下限`);

  assert.match(css, /--geo-station-avatar:\s*calc\(var\(--geo-station-card\)/, '头像必须由站点卡派生');
  assert.ok(rail.includes('size-station-card'), '站点卡与骨架必须共用 size-station-card 具名 utility');
  assert.equal(rail.includes('size-[42px]'), false, 'LeftRail 不得回落到 42px 死尺寸');
  assert.match(rail, /size="var\(--geo-station-avatar/, '站点头像必须由 --geo-station-avatar 派生尺寸');
});

test('顶栏高度：DIMENSIONS 与 :root 真值必须同源（跨语言单一真值）', () => {
  const css = read('packages/desktop/src/renderer/styles.css');
  const tokens = read('packages/ui/src/tokens/tokens.ts');

  const cssHeight = Number(/--geo-titlebar:\s*(\d+)px/.exec(css)?.[1]);
  const tsHeight = Number(/titlebarHeight:\s*(\d+)/.exec(tokens)?.[1]);
  assert.ok(cssHeight > 0, ':root 必须定义 --geo-titlebar');
  assert.equal(tsHeight, cssHeight, `DIMENSIONS.titlebarHeight(${tsHeight}) 必须等于 --geo-titlebar(${cssHeight})，否则 TS 与 CSS 各说各话`);
  assert.ok(cssHeight >= 28, `顶栏内容高 ${cssHeight}px 不得低于 28px 图标热区`);
});

test('移动端标题让位必须覆盖两簇图标实占（禁止写死 120px）', () => {
  const css = read('packages/desktop/src/renderer/styles.css');
  const start = css.indexOf('@media (max-width: 768px)');
  const mobile = css.slice(start);

  const centerBlock = /\.titlebar-center\s*\{([^}]*)\}/.exec(mobile)?.[1] ?? '';
  const reserve = /max-width:\s*calc\(100% - (\d+)px\)\s*!important/.exec(centerBlock)?.[1];
  assert.ok(reserve, '移动端标题必须声明 max-width 让位表达式');
  // 左簇实占 = inset 8 + ☰ 28 + gap 16 + 设置 28 = 80；两侧对称故 ≥160。
  // gap 16 是 44px 触控热区外扩 8px 后的必需值（8px gap 会让两键命中区重叠 8px）。
  const leftBlocks = [...mobile.matchAll(/\.titlebar-left\s*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(
    leftBlocks.some((block) => /gap:\s*16px/.test(block)),
    '移动端左簇 gap 必须 16px，否则 44px 命中区相互重叠 8px',
  );
  assert.ok(Number(reserve) >= 160, `移动端两侧让位 ${reserve}px 不足以覆盖两簇图标（左簇实占 80px/侧）`);

  // 触控热区不得靠撑大按钮盒：否则 32px 顶栏里 44px 的按下底色会溢到对话区。
  const iconRule = /\.flux-titlebar \.icon-btn\s*\{([^}]*)\}/.exec(mobile)?.[1] ?? '';
  assert.match(iconRule, /min-height:\s*28px/, '顶栏图标按钮视觉盒必须保持 28px');
  assert.match(mobile, /\.flux-titlebar \.icon-btn::after\s*\{[^}]*inset:\s*-8px/, '44px 命中区必须由伪元素外扩');
});

test('连接指示点：必须有显式 display，不得依赖父级 flex 的块化', () => {
  const css = read('packages/desktop/src/renderer/styles.css');
  const rule = /\.titlebar-connection-indicator\s*\{([^}]*)\}/.exec(css)?.[1];
  assert.ok(rule, '必须存在 .titlebar-connection-indicator 规则');
  // inline 元素上的 width/height 会被浏览器直接忽略：一旦父级不再是 flex，
  // 指示点会静默变成 0×0（悬停提示还在，屏幕上什么都没有）。
  assert.match(rule, /display:\s*inline-block/, '指示点必须显式 inline-block');
  assert.match(rule, /width:\s*7px/, '指示点宽度必须 7px');
});

test('非 Windows 平台：右簇必须与左簇对称留 8px（不得贴死窗口右缘）', () => {
  const css = read('packages/desktop/src/renderer/styles.css');
  const rule = /html\[data-platform="macos"\] \.titlebar-right,[\s\S]{0,400}?\.titlebar-right\s*\{([^}]*)\}/.exec(css)?.[1];
  assert.ok(rule, '必须存在非 Windows 平台的 .titlebar-right 右内距规则');
  assert.match(rule, /padding-right:\s*calc\(8px \+ env\(safe-area-inset-right/, '右内距必须 8px 起且叠加安全区');
  for (const platform of ['macos', 'linux', 'ios', 'android', 'web']) {
    assert.ok(css.includes(`html[data-platform="${platform}"] .titlebar-right`), `${platform} 平台必须纳入对称留白`);
  }
  // 反向对照：Windows 必须留在列表之外，否则窗控三键会离窗口边缘 8px（违反系统惯例）。
  assert.equal(css.includes('html[data-platform="windows"] .titlebar-right'), false, 'Windows 不得套用右内距');
});

test('标题与左段：展开方向过渡必须与左栏同频（enter 120ms）', () => {
  const css = read('packages/desktop/src/renderer/styles.css');

  // 左栏在非折叠态把时长切到 --duration-enter（styles.css 内 #flux-left-rail:not(.rail-collapsed)）
  // 顶栏左段与标题若不跟随，展开时左栏 120ms 到位、它们仍走 200ms → 中间错位窗口
  const enterSelectors = css.match(/:not\(\[data-left-rail-collapsed="true"\]\)\s*\.titlebar-(left|center)\s*\{[^}]*--duration-enter[^}]*\}/g) ?? [];
  assert.ok(enterSelectors.length >= 2, `左侧展开方向必须为 .titlebar-left 与 .titlebar-center 各声明一次 enter 时长，实际 ${enterSelectors.length} 处`);
});

test('标题居中：移动端必须复位为窗口居中（左栏是浮层、检查舱是全屏 Sheet）', () => {
  const css = read('packages/desktop/src/renderer/styles.css');
  const start = css.indexOf('@media (max-width: 768px)');
  assert.ok(start > 0, '移动端媒体查询块必须存在');
  const block = css.slice(start);
  assert.match(block, /\.titlebar-center\s*\{[^}]*left:\s*50%\s*!important/, '移动端标题必须复位 left:50%，否则 390px 下偏左 78px');
});

test('平台标识：data-platform 必须由 render 路径写入且带同值跳过', () => {
  const coord = read('packages/desktop/src/renderer/renderCoordinator.ts');
  assert.match(coord, /dataset\.platform|setAttribute\(['"]data-platform['"]/, '必须写入 data-platform');
  assert.match(coord, /data-platform['"]\s*\)?\s*!==\s*state\.platform/, '写入前必须比对旧值，避免高频 render 反复触发样式重算');
});
