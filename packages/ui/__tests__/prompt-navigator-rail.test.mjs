/**
 * 提示词导航轨渲染契约（服务端静态渲染，可落盘）。
 *
 * 断言口径：
 *   1. 结构与几何断言直接打真实导出（组件静态渲染 + 纯模型），不 mock；
 *   2. 覆盖「有轨道 / 不足两条 / 空表」三态，防止组件在空数据上抛错；
 *   3. 宿主 host 必须出现在中间舱骨架里，且位于滚动容器之后；
 *   4. 同源守卫读 `src` 源码，不读 `dist`：产物在未构建时可能是旧的，会造成假绿。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { PromptNavigatorRail } from '../dist/components-react/conversation/PromptNavigatorRail.js';
import { renderMiddlePod } from '../dist/components/MiddlePod/MiddlePod.js';
import {
  PANEL_OVERSCAN_ROWS,
  PANEL_ROW_PX,
  PANEL_VISIBLE_ROWS,
  buildPanelRowProps,
  ensurePanelOffset,
  planPanelRows,
} from '../dist/lib/promptNavigator.js';

const prompts = [
  { id: 'u1', index: 0, preview: '第一问' },
  { id: 'u2', index: 2, preview: '第二问' },
  { id: 'u3', index: 4, preview: '第三问' },
];

function renderRail(entries, activeIndex) {
  return renderToStaticMarkup(
    createElement(PromptNavigatorRail, {
      snapshot: { prompts: entries, activeIndex },
      actions: { onSelect: () => {} },
    })
  );
}

test('三条提问渲染三根 tick，当前项带 aria-current', () => {
  const html = renderRail(prompts, 2);
  const ticks = html.match(/role="option"/g) ?? [];
  assert.equal(ticks.length, 3, '每条提问恰好一根 tick');
  assert.equal((html.match(/aria-current="true"/g) ?? []).length, 1, '当前项唯一');
  assert.match(html, /role="listbox"/);
  assert.match(html, /aria-label="提示词导航"/, 'gutter 的可访问名必须走 i18n 词典');
  assert.match(html, /conv-prompt-rail__tick-bar/);
});

test('不足两条提问不渲染轨道', () => {
  assert.equal(renderRail([], -1), '');
  assert.equal(renderRail([prompts[0]], 0), '');
});

test('当前项越界时按末条处理，且不抛错', () => {
  const html = renderRail(prompts, 999);
  assert.equal((html.match(/role="option"/g) ?? []).length, 3);
  assert.equal((html.match(/aria-current="true"/g) ?? []).length, 1);
});

test('中间舱骨架输出导航轨 host，且位于滚动容器之后', () => {
  const html = renderMiddlePod({
    gatewayConnected: true,
    messages: [
      { id: 'u1', role: 'user', content: '第一问', timestamp: '2026-11-10T00:00:00Z' },
      { id: 'a1', role: 'assistant', content: '答复', timestamp: '2026-11-10T00:00:01Z' },
      { id: 'u2', role: 'user', content: '第二问', timestamp: '2026-11-10T00:00:02Z' },
    ],
    dockHtml: '',
  });
  const streamAt = html.indexOf('id="conversation-stream"');
  const hostAt = html.indexOf('id="react-prompt-navigator-host"');
  assert.ok(streamAt >= 0, '滚动容器必须存在');
  assert.ok(hostAt > streamAt, 'host 必须挂在滚动容器之后，绝不能进流');
});

/**
 * 面板行的数据形状与几何契约。
 *
 * 【为什么断言模型而不是读产物】面板只在 hover 时挂载，服务端静态渲染进不去该状态；
 *   而读产物字符串只能拦住「旧类名回流」，序号换个名字重新渲染就全绿了。
 *   把行形状收敛成 `planPanelRows` 后，直接断言「每行只有 text、没有 index 列」，
 *   以及几何真值（行高 / 可见行数）在 TS 与 CSS 两侧严格同源。
 */
test('面板行只带预览正文，不含任何序号字段', () => {
  // previewOf 必须返回与 entry.preview 不同构的值，否则「组件忽略注入、直接用 entry.preview」的变异无法被杀。
  const rows = planPanelRows(prompts, {
    offset: 0,
    activeIndex: 1,
    highlightedIndex: 2,
    previewOf: (entry) => `P:${entry.preview}`,
  });
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.deepEqual(
      Object.keys(row).sort(),
      ['id', 'index', 'isActive', 'isHighlighted', 'text', 'top'],
      '行的字段集必须恒定，多出序号字段即回归'
    );
    assert.notEqual(row.text.length, 0);
  }
  assert.deepEqual(
    rows.map((row) => row.text),
    ['P:第一问', 'P:第二问', 'P:第三问'],
    '正文必须来自注入的 previewOf，且不带任何编号前缀'
  );
});

test('面板行的纵向位置与高亮判定由绝对下标决定', () => {
  const rows = planPanelRows(prompts, {
    offset: 1,
    activeIndex: 2,
    highlightedIndex: 1,
    previewOf: (entry) => entry.preview,
  });
  assert.deepEqual(rows.map((row) => row.index), [1, 2]);
  assert.deepEqual(rows.map((row) => row.top), [40, 80], '纵向位置按 40px 行高逐行递增');
  assert.deepEqual(rows.map((row) => row.isActive), [false, true]);
  assert.deepEqual(rows.map((row) => row.isHighlighted), [true, false]);
});

test('面板只挂可见行加 overscan，长会话不进全量 DOM', () => {
  const many = Array.from({ length: 400 }, (_, i) => ({ id: `u${i}`, index: i, preview: `第 ${i} 问` }));
  const rows = planPanelRows(many, {
    offset: 120,
    activeIndex: 121,
    highlightedIndex: null,
    previewOf: (entry) => entry.preview,
  });
  // 期望值写成字面量：若改成引用常量，overscan 取任意值都全绿，DOM 预算就没有守卫了。
  assert.equal(rows.length, 10, '挂载行数 = 8 可见 + 2 overscan，多挂即突破 DOM 预算');
  assert.equal(rows[0].index, 120);
  assert.equal(rows[9].index, 129);
  assert.equal(PANEL_VISIBLE_ROWS, 8, '可见行数是 8 行面板的唯一定义');
  assert.equal(PANEL_OVERSCAN_ROWS, 2, 'overscan 是滑行不露白的唯一定义');
});

test('小数偏移向下取整，起点必须落在真实行上', () => {
  const rows = planPanelRows(prompts, {
    offset: 1.5,
    activeIndex: 0,
    highlightedIndex: null,
    previewOf: (entry) => entry.preview,
  });
  assert.notEqual(rows.length, 0, '小数偏移不得把面板整块算空');
  assert.equal(rows[0].index, 1, '起点向下取整到第 1 行');
});

test('偏移越界与末端都要被夹住，不得读出窗口外或数组外', () => {
  const many = Array.from({ length: 400 }, (_, i) => ({ id: `u${i}`, index: i, preview: `第 ${i} 问` }));
  const clampOffset = (offset, total) => planPanelRows(many.slice(0, total), {
    offset,
    activeIndex: 0,
    highlightedIndex: null,
    previewOf: (entry) => entry.preview,
  });
  // 偏移超过末条：起点必须夹到 total - 1，而不是越界读出 undefined
  const tail = clampOffset(999, 3);
  assert.equal(tail[0].index, 2, '偏移超上界时起点夹到末条');
  assert.equal(tail.length, 1, '只有末条可挂');
  // 末端封顶：396 起读 400 条，只能拿到 4 行，不能凑满 visible + overscan
  const end = clampOffset(396, 400);
  assert.equal(end.length, 4, '末端必须封顶到数组长度，不得补空行');
  assert.equal(end[end.length - 1].index, 399);
});

test('空 id 与非字符串 id 的行被剔除，不补造占位', () => {
  const dirty = [
    { id: 'ok-1', index: 0, preview: '正常' },
    { id: '', index: 1, preview: '空 id' },
    { id: 42, index: 2, preview: '非字符串 id' },
    { id: 'ok-2', index: 3, preview: '正常' },
  ];
  const rows = planPanelRows(dirty, {
    offset: 0,
    activeIndex: 0,
    highlightedIndex: null,
    previewOf: (entry) => entry.preview,
  });
  assert.deepEqual(rows.map((row) => row.id), ['ok-1', 'ok-2'], '脏 id 必须剔除且不打乱余下顺序');
  assert.deepEqual(rows.map((row) => row.index), [0, 3], 'index 保留原下标，不做重编号');
});

test('面板偏移恒夹在可见窗口内，贴边才滑动', () => {
  assert.equal(ensurePanelOffset(0, 0, 40), 0, '顶到首条不下滑');
  assert.equal(ensurePanelOffset(39, 0, 40), 32, '末条最多滑到 total - 可见行数');
  assert.equal(ensurePanelOffset(5, 0, 40), 0, '距顶部不足 2 行时保持不动');
  assert.equal(ensurePanelOffset(20, 0, 40), 15, '超出底部可见区时按可见行数回推');
  assert.equal(ensurePanelOffset(3, 0, 5), 0, '总数不足一屏时恒为 0');
  // 传入的偏移自身越界时也要夹住：负偏移会让 translateY 变成正值，面板整体下滑露白。
  assert.equal(ensurePanelOffset(0, -3, 40), 0, '负偏移不得把面板推下去');
  assert.equal(ensurePanelOffset(39, 999, 40), 32, '超大偏移不得滚过末条');
  // 偏移已非零、高亮又贴到窗口顶部：必须把窗口上移两行，保住上下 2 行上下文。
  // 这正是本函数存在的理由；只用 base=0 的输入永远走不到这条分支。
  assert.equal(ensurePanelOffset(10, 10, 40), 8, 'offset 非零时高亮贴顶必须回推 2 行上下文');
  assert.equal(ensurePanelOffset(11, 10, 40), 9, '距顶 1 行时同样回推 2 行');
});

/**
 * 行高与可见行数的单一真值守卫。
 *
 * 【设计意图 (Why)】面板高度、滚轮步进与 translateY 全部按行高计算；
 *   TS 常量与 CSS 变量一旦分叉，每次滚轮都会累积错位，而视觉上只像是"滚动滚过头了"。
 * 【约束与规则 (Rules)】读源码而不是产物：源码是真值，产物在未构建时可能是旧的。
 */
test('面板行高与可见行数在 TS 与 CSS 两侧严格同源', () => {
  const css = fs.readFileSync(new URL('../src/styles/conversation.css', import.meta.url), 'utf8');
  const rowPx = Number(/--conv-prompt-panel-row:\s*(\d+)px/.exec(css)?.[1]);
  const visible = Number(/--conv-prompt-panel-visible:\s*(\d+)/.exec(css)?.[1]);
  // 字面量锚点：只断言「两侧相等」时，TS 与 CSS 同步漂移到 44px 也全绿。
  assert.equal(PANEL_ROW_PX, 40, '行高真值是 40px');
  assert.equal(PANEL_VISIBLE_ROWS, 8, '可见行数真值是 8');
  assert.equal(rowPx, 40, 'CSS 行高必须与 TS 真值一致');
  assert.equal(visible, 8, 'CSS 可见行数必须与 TS 真值一致');
  assert.equal(PANEL_ROW_PX % 4, 0, '行高必须落在 4px 网格上');
  assert.match(
    css,
    /height:\s*calc\(var\(--conv-prompt-panel-row\)\s*\*\s*var\(--conv-prompt-panel-visible\)\)/,
    '面板视口高度必须由这两个变量算出，禁止写成魔法数字'
  );
});

test('轨道与面板样式不再保留序号选择器', () => {
  const css = fs.readFileSync(new URL('../src/styles/conversation.css', import.meta.url), 'utf8');
  // 剥掉注释再匹配：本仓的注释文化会记录「曾用过的类名」，那不是残留选择器。
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(withoutComments, /conv-prompt-rail__panel-index/, '样式表不得再保留序号选择器');
});

/**
 * 面板浮层与行盒的样式守卫。
 *
 * 【设计意图 (Why)】这些值都是物理契约，改坏了只能是肉眼可见的回归：
 *   遮蔽换成 --shadow-card 会在两个浅色皮肤叠出双线；行内 padding 与遮罩高度漂移会让
 *   文字贴边、渐隐露边；焦点环退回 --ring 会在浅色皮肤失去对比。
 * 【约束与规则 (Rules)】按选择器块切分后逐段断言，避免全局正则误命中别处。
 */
test('面板浮层遮蔽不叠加描边、行盒与遮罩几何不得漂移', () => {
  const css = fs.readFileSync(new URL('../src/styles/conversation.css', import.meta.url), 'utf8');
  const blockOf = (selector) => {
    const start = css.indexOf(`${selector} {`);
    assert.ok(start >= 0, `样式表必须存在 ${selector} 规则`);
    // 剥掉注释：本仓注释会解释「为什么不能用 --shadow-card」，那不是真的在用。
    return css.slice(start, css.indexOf('}', start)).replace(/\/\*[\s\S]*?\*\//g, '');
  };

  const panel = blockOf('.conv-prompt-rail__panel');
  assert.match(panel, /box-shadow:\s*var\(--shadow-window\)/, '浮层遮蔽必须用 --shadow-window');
  assert.doesNotMatch(panel, /--shadow-card/, '--shadow-card 在浅色皮肤自带 1px 描边，与 border 并存会成双线');
  assert.match(panel, /border:\s*1px solid var\(--border\)/, '浮层边框走 --border 档');
  assert.doesNotMatch(panel, /border-top-color:\s*var\(--specular-line\)/, '--specular-line 是 box-shadow 片段，写进 border-color 会被整条丢弃');
  assert.match(panel, /transform:\s*translateY\(-50%\)/, '面板必须按 top:50% + translateY(-50%) 垂直居中');

  const row = blockOf('.conv-prompt-rail__panel-row');
  assert.match(row, /padding:\s*0 8px/, '行内左右内缩固定 8px');
  assert.doesNotMatch(row, /outline:\s*none/, '行不进 Tab 序列，不需要压掉原生焦点环');
  assert.doesNotMatch(row, /gap:/, '行内只剩一段正文，不需要 flex gap');

  const text = blockOf('.conv-prompt-rail__panel-text');
  assert.match(text, /line-height:\s*18px/, '13px 正文配 18px 行高，禁止退回倍率');

  const mask = blockOf('.conv-prompt-rail__panel-mask');
  assert.match(mask, /height:\s*24px/, '遮罩高度固定 24px，不用百分比随行数浮动');

  const gutterFocusAt = css.indexOf('.conv-prompt-rail__gutter:focus-visible {');
  assert.ok(gutterFocusAt >= 0, '样式表必须存在 gutter 的 focus-visible 规则');
  const gutterFocus = css.slice(gutterFocusAt, css.indexOf('}', gutterFocusAt));
  // 正向锚点：只否定 --ring 拦不住「退回 22% 前景混色」这种同族低对比回退。
  assert.match(
    gutterFocus,
    /color-mix\(in oklab, var\(--foreground\) 60%, transparent\)/,
    '焦点环必须是 60% 前景混色，2px 轮廓才在浅色皮肤上可辨'
  );

  // 派生态：当前项与悬停项的判别只能靠这两条，删掉或改值都会退化成「整列一个样」。
  assert.match(
    blockOf('.conv-prompt-rail__panel-row.is-active'),
    /box-shadow:\s*inset 2px 0 0 color-mix\(in oklab, var\(--foreground\) 55%, transparent\)/,
    '当前项必须有 2px 左侧条'
  );
  const highlighted = blockOf('.conv-prompt-rail__panel-row.is-highlighted');
  assert.match(
    highlighted,
    /background:\s*color-mix\(in oklab, var\(--foreground\) 7%, transparent\)/,
    '悬停项底色是 7% 前景混色'
  );
  assert.doesNotMatch(highlighted, /box-shadow/, '悬停项不得再叠左侧条，否则与当前项混淆');

  // 几何与浮层契约：这些值本轮都改过，必须有锚点，否则漂移只能靠肉眼发现。
  assert.match(blockOf('.conv-prompt-rail'), /right:\s*16px/, '轨道贴右侧 16px');
  assert.match(panel, /right:\s*calc\(100% \+ 16px\)/, '面板与轨道间距 16px');
  assert.match(panel, /width:\s*min\(20rem, calc\(100vw - 7rem\)\)/, '面板宽度与视口夹取');
  assert.match(panel, /border-radius:\s*var\(--radius-panel, 8px\)/, '浮层圆角走 --radius-panel');
  // 关键帧名必须精确到大括号：前缀匹配会让「改名成 xxxV2」这种最常见的破坏方式静默通过。
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(withoutComments, /@keyframes\s+convPromptPanelEnter\s*\{/, '关键帧名必须精确等于 animation 引用的名字');
  assert.match(panel, /animation:\s*convPromptPanelEnter 120ms/, '进场动画 120ms');

  /**
   * reduced-motion 的断言必须做配对大括号切片。
   * `[\s\S]*` 会一路匹配到文件末尾别的 `animation: none`，恒真且拦不住三条破坏方式：
   * 整块删除、改成具体时长、媒体条件取反。
   */
  const mediaBlocks = (source, condition) => {
    const blocks = [];
    const needle = `@media ${condition} {`;
    let from = 0;
    for (;;) {
      const at = source.indexOf(needle, from);
      if (at < 0) return blocks;
      let cursor = source.indexOf('{', at);
      let depth = 0;
      for (; cursor < source.length; cursor += 1) {
        if (source[cursor] === '{') depth += 1;
        else if (source[cursor] === '}' && (depth -= 1) === 0) break;
      }
      blocks.push(source.slice(at, cursor + 1));
      from = cursor + 1;
    }
  };
  const ruleBlock = (source, selector) => {
    const at = source.indexOf(`${selector} {`);
    assert.ok(at >= 0, `样式表必须存在 ${selector} 规则`);
    let cursor = source.indexOf('{', at);
    let depth = 0;
    for (; cursor < source.length; cursor += 1) {
      if (source[cursor] === '{') depth += 1;
      else if (source[cursor] === '}' && (depth -= 1) === 0) break;
    }
    return source.slice(at, cursor + 1);
  };

  const reduceBlocks = mediaBlocks(withoutComments, '(prefers-reduced-motion: reduce)');
  const panelReduce = reduceBlocks.filter((block) => block.includes('.conv-prompt-rail__panel'));
  assert.equal(panelReduce.length, 1, 'reduced-motion 下必须恰有一处面板规则');
  // 只切到块内还不够：把媒体条件取反成 no-preference 时块内容原封不动，
  // 所以必须连块头的条件文本一起锚定。
  assert.match(
    panelReduce[0],
    /^@media \(prefers-reduced-motion: reduce\) \{/,
    '面板的动效抑制必须挂在 prefers-reduced-motion: reduce 下，条件取反即失效'
  );
  assert.match(
    ruleBlock(panelReduce[0], '.conv-prompt-rail__panel'),
    /animation:\s*none/,
    'reduced-motion 必须关掉进场动画，且规则必须落在面板选择器块内'
  );

  // 三档亮度必须走语义前景 Token：前景百分比混色在浅色皮肤会掉到 2:1 以下，2px 指示器直接不可见。
  assert.match(
    blockOf('.conv-prompt-rail__tick-bar'),
    /background:\s*var\(--muted-foreground\)/,
    '常规档必须走 --muted-foreground'
  );
  assert.match(
    blockOf('.conv-prompt-rail__tick.is-highlighted .conv-prompt-rail__tick-bar'),
    /background:\s*var\(--secondary-foreground\)/,
    '悬停档必须取中间档 --secondary-foreground'
  );
  assert.match(
    blockOf('.conv-prompt-rail__tick.is-active .conv-prompt-rail__tick-bar'),
    /background:\s*var\(--foreground\)/,
    '当前档必须是最高对比的 --foreground'
  );
});

/**
 * 面板内缩的 8pt 网格契约。
 *
 * 【为什么单独守】内缩是浮层留白的唯一定义，变量与兜底值漂移会让文字贴边，
 *   而这条链路只有 CDP 会红，单测必须自己盯住。
 */
test('面板内缩变量与兜底值都为 8px', () => {
  const css = fs.readFileSync(new URL('../src/styles/conversation.css', import.meta.url), 'utf8');
  assert.match(css, /--conv-prompt-panel-pad:\s*8px/, '内缩变量真值必须是 8px');
  const panelAt = css.indexOf('.conv-prompt-rail__panel {');
  assert.ok(panelAt >= 0, '样式表必须存在面板规则');
  const panel = css.slice(panelAt, css.indexOf('}', panelAt));
  assert.match(panel, /padding:\s*var\(--conv-prompt-panel-pad, 8px\)/, '面板必须消费该变量且兜底 8px');
});

/**
 * 面板行的渲染属性包：这是面板渲染分支的落盘守卫。
 *
 * 【为什么测它】面板只在 hover 时挂载，`renderToStaticMarkup` 进不到 `panelOpen=true`；
 *   组件自己的类名、tabIndex、点击载荷、几何一旦被改坏，此前没有任何断言能发现。
 */
test('渲染属性包：类名、Tab 序列、点击载荷、几何全部按契约产出', () => {
  const rows = planPanelRows(prompts, {
    offset: 0,
    activeIndex: 1,
    highlightedIndex: 2,
    previewOf: (entry) => entry.preview,
  });
  const propsList = rows.map((row) => buildPanelRowProps(row));

  assert.deepEqual(
    Object.keys(propsList[0]).sort(),
    ['ariaCurrent', 'className', 'selectId', 'tabIndex', 'text', 'top'],
    '属性包字段集恒定，多出字段即渲染层契约被改'
  );

  assert.deepEqual(propsList.map((props) => props.className), [
    'conv-prompt-rail__panel-row',
    'conv-prompt-rail__panel-row is-active',
    'conv-prompt-rail__panel-row is-highlighted',
  ], '当前位与高亮位必须映射到类名');

  assert.deepEqual(propsList.map((props) => props.ariaCurrent), [undefined, 'true', undefined], '只有当前位带 aria-current');

  for (const props of propsList) {
    assert.equal(props.tabIndex, -1, '面板行不得进 Tab 序列，键盘通路统一走 gutter');
  }

  assert.deepEqual(
    propsList.map((props) => props.top),
    ['0px', '40px', '80px'],
    '几何必须由 40px 行高推算（字面量锚点），印证 panel-track 的位移口径'
  );

  // 点击载荷必须是消息 id：下标会被前置翻页整体平移，跨边界传下标必然跳错行。
  assert.deepEqual(propsList.map((props) => props.selectId), ['u1', 'u2', 'u3']);
  for (const props of propsList) {
    assert.equal(typeof props.selectId, 'string', '点击载荷只能是字符串 id');
    assert.equal(Number.isInteger(Number(props.selectId)), false, 'id 不得是纯数字下标');
  }
  assert.deepEqual(propsList.map((props) => props.text), ['第一问', '第二问', '第三问'], '行内唯一的可见内容是预览正文');
});

/**
 * 渲染层接线：属性包必须原样铺到行按钮上。
 *
 * 【为什么读 TSX 源码】面板只在 hover 时挂载，服务端静态渲染进不到该分支；
 *   只断言 buildPanelRowProps 的返回值，拦不住「组件把返回值丢掉、自己另算一遍」。
 *   这条断言盯的是消费端，与上面的模型断言互补，缺任一侧都有盲区。
 */
test('渲染层接线：属性包原样铺到行按钮，行内只有一段正文', () => {
  const tsx = fs.readFileSync(
    new URL('../src/components-react/conversation/PromptNavigatorRail.tsx', import.meta.url),
    'utf8'
  );
  assert.match(tsx, /tabIndex=\{props\.tabIndex\}/, 'tabIndex 必须来自属性包');
  assert.match(tsx, /className=\{props\.className\}/, '类名必须来自属性包');
  assert.match(tsx, /style=\{\{ top: props\.top \}\}/, '几何必须来自属性包，不得在组件内另算');
  assert.match(tsx, /aria-current=\{props\.ariaCurrent\}/, 'aria-current 必须来自属性包');
  assert.match(tsx, /key=\{props\.selectId\}/, 'React key 必须用消息 id');
  assert.match(tsx, /actions\.onSelect\(props\.selectId\)/, '点击载荷必须是 id，不得是易失下标');
  assert.match(tsx, /setHighlightedIndex\(row\.index\)/, 'hover 必须回写绝对下标');
  assert.match(
    tsx,
    /translateY\(-\$\{panelOffset \* PANEL_ROW_PX\}px\)/,
    'panel-track 位移必须乘行高，量纲错会让滚轮一行跳错位置'
  );

  const btnStart = tsx.indexOf('<button');
  assert.ok(btnStart >= 0, '面板行必须渲染成 button');
  const btn = tsx.slice(btnStart, tsx.indexOf('</button>', btnStart));
  assert.equal((btn.match(/<span/g) ?? []).length, 1, '行内只允许一段正文，序号 span 回流即回归');
  assert.doesNotMatch(btn, /panel-index/, '行内不得出现序号槽位');
});

/**
 * 行高单一真值：行的纵向位置必须引用行高常量，不得写死数值。
 *
 * 【为什么单独守】buildPanelRowProps 的 Rules 明写「禁止出现第二份行高真值」；
 *   把 `PANEL_ROW_PX` 换成任何立即数（40、44 都一样）行为看似一致，
 *   但常量就不再是唯一真值源，改行高时这一处必被漏掉。计数式断言拦不住 44，必须锚定表达式。
 */
test('行的纵向位置必须引用 PANEL_ROW_PX，不得写死数值', () => {
  const lib = fs.readFileSync(new URL('../src/lib/promptNavigator.ts', import.meta.url), 'utf8');
  assert.match(lib, /top:\s*i \* PANEL_ROW_PX,/, '模型里的 top 必须由行高常量推算');
  assert.match(
    lib,
    /top:\s*`\$\{row\.index \* PANEL_ROW_PX\}px`,/,
    '渲染属性包的 top 必须由行高常量推算'
  );
  const withoutComments = lib.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.equal((withoutComments.match(/\b40\b/g) ?? []).length, 1, '40 只应出现在 PANEL_ROW_PX 的定义处');
});

test('加载态渲染契约：isLoadingOlder 切换 is-loading-older 与 aria-busy', () => {
  const idleHtml = renderToStaticMarkup(
    createElement(PromptNavigatorRail, {
      snapshot: { prompts, activeIndex: 1, hasOlder: true, isLoadingOlder: false },
      actions: { onSelect: () => {}, onLoadOlder: () => {} },
    })
  );
  assert.doesNotMatch(idleHtml, /is-loading-older/, '空闲态不得挂加载类名');
  assert.doesNotMatch(idleHtml, /aria-busy="true"/, '空闲态不得声明 aria-busy');

  const loadingHtml = renderToStaticMarkup(
    createElement(PromptNavigatorRail, {
      snapshot: { prompts, activeIndex: 1, hasOlder: true, isLoadingOlder: true },
      actions: { onSelect: () => {}, onLoadOlder: () => {} },
    })
  );
  assert.match(loadingHtml, /class="conv-prompt-rail is-loading-older"/, '加载态必须激活轨道脉冲类名');
  assert.match(loadingHtml, /aria-busy="true"/, '加载态必须宣告 aria-busy');
});

test('顶部拉取历史：接线、文案 i18n 与方案 1 刻度脉冲流样式契约', () => {
  const tsx = fs.readFileSync(
    new URL('../src/components-react/conversation/PromptNavigatorRail.tsx', import.meta.url),
    'utf8'
  );
  assert.match(tsx, /decidePanelWheelAction\(/, '面板滚轮必须委托纯决策函数');
  assert.match(tsx, /decideGutterKeyAction\(/, '键盘导航必须委托纯决策函数');
  assert.match(tsx, /decideHotzonePointerAction\(/, '热区悬停必须委托纯决策函数');
  assert.match(tsx, /planPromptPrependView\(/, '头部插页必须经纯函数同步窗口与面板偏移');
  assert.match(tsx, /topHotzoneTriggeredRef\.current = false;/, '头部插页后必须复位热区触发锁');
  assert.match(tsx, /actions\.onLoadOlder\?\.\(\)/, '触发动作必须调用 actions.onLoadOlder');
  assert.match(tsx, /t\('conversation\.promptNavigator\.querying'\)/, '查询文案必须走 i18n 字典');
  assert.doesNotMatch(tsx, /正在查询数据/, 'TSX 源码不得出现硬编码中文文案');
  assert.doesNotMatch(tsx, /cascade-skel/, '面板状态行必须保持极简单行，不得带骨架横条');
  assert.doesNotMatch(
    tsx,
    /\{isLoadingOlder\s*\?\s*\(\s*<div className="conv-prompt-rail__panel-loader"/,
    '状态行内容节点必须保活，不得在 isLoadingOlder 置假时卸载导致退场动画断头'
  );

  const i18n = fs.readFileSync(new URL('../src/i18n/index.ts', import.meta.url), 'utf8');
  assert.match(i18n, /'conversation\.promptNavigator\.querying':\s*'正在查询数据'/);
  assert.match(i18n, /'conversation\.promptNavigator\.querying':\s*'Querying data'/);

  const css = fs.readFileSync(new URL('../src/styles/conversation.css', import.meta.url), 'utf8');
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(withoutComments, /@keyframes\s+convPromptTickCascade\s*\{/, '轨道刻度脉冲流关键帧必须精确存在');
  assert.match(withoutComments, /@keyframes\s+convPromptLoaderBarPulse\s*\{/, '面板微脉冲竖条关键帧必须精确存在');
  assert.match(
    withoutComments,
    /\.conv-prompt-rail\.is-loading-older \.conv-prompt-rail__tick:nth-child\(-n\+5\) \.conv-prompt-rail__tick-bar/,
    '刻度脉冲动画仅允许绑定在 .is-loading-older 下的前 5 根刻度上，稳态零空转'
  );
  assert.match(
    withoutComments,
    /\.conv-prompt-rail\.is-loading-older \.conv-prompt-rail__loader-bars > span/,
    '竖条脉冲动画必须限定在 .is-loading-older 状态作用域内，稳态零空转'
  );
  const wrapAt = withoutComments.indexOf('.conv-prompt-rail__panel-loader-wrap {');
  const wrapBlock = withoutComments.slice(wrapAt, withoutComments.indexOf('}', wrapAt));
  assert.match(wrapBlock, /var\(--duration-exit,\s*200ms\)/, '收起过渡必须消费 --duration-exit 非对称退场时长');
  assert.match(wrapBlock, /var\(--ease-spring,/, '折叠过渡必须消费 --ease-spring 缓动');

  const openAt = withoutComments.indexOf('.conv-prompt-rail__panel-loader-wrap.is-open {');
  const openBlock = withoutComments.slice(openAt, withoutComments.indexOf('}', openAt));
  assert.match(openBlock, /var\(--duration-enter,\s*120ms\)/, '展开过渡必须消费 --duration-enter 非对称入场时长');

  const barAt = withoutComments.indexOf('.conv-prompt-rail__loader-bars > span {');
  const barBlock = withoutComments.slice(barAt, withoutComments.indexOf('}', barAt));
  assert.match(barBlock, /border-radius:\s*var\(--radius-pill,\s*9999px\)/, '竖条端帽圆角必须走 --radius-pill Token');
  assert.doesNotMatch(barBlock, /animation:/, '稳态竖条不得绑定 infinite 动画');
});
