/**
 * 模型选择器交互契约单测 (Model Picker Interaction)
 *
 * 【覆盖目标】
 *   1. provider 分组必须能真正折叠/展开：DOM 要带可被宿主读取的状态（`data-collapsed` / `aria-expanded`），
 *      且折叠只影响该分组自身；
 *   2. 搜索必须无视折叠——否则命中的模型被折叠起来，用户会以为「搜不到」；
 *   3. 「思考等级」已从输入舱 footer 下沉为模型行右侧的二级级联：footer 不得再残留入口，
 *      级联面板必须完整列出等级并标出当前值；
 *   4. 每行要有二级菜单的可发现性提示。
 *
 * 【为什么这些断言必须存在】
 *   折叠与级联都由桌面端事件绑定驱动，UI 只产出字符串。字符串漏了 `data-provider`
 *   或 `aria-expanded`，点击就静默失效——不报错、不破图，只能靠断言锁住。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { renderInputDock, renderModelPickerTree } from '../../dist/components/InputDock/InputDock.js';

const CATALOG = [
  {
    id: 'anthropic/claude-opus-5',
    providerSlug: 'cpa',
    providerName: 'cpa',
    name: 'Opus 5',
    displayName: 'Opus 5',
    variant: '',
    quant: '',
    context: '',
    route: '',
    date: '',
    vendor: 'Anthropic',
    vendorId: 'anthropic',
    featured: false,
    unavailable: false,
  },
  {
    id: 'deepseek-v4.1-flash',
    providerSlug: 'cpa',
    providerName: 'cpa',
    name: 'DeepSeek V4.1 Flash',
    displayName: 'DeepSeek V4.1 Flash',
    variant: 'Flash',
    quant: '',
    context: '',
    route: '',
    date: '',
    vendor: 'DeepSeek',
    vendorId: 'deepseek',
    featured: false,
    unavailable: false,
  },
  {
    id: 'grok-4.20',
    providerSlug: 'xai-oauth',
    providerName: 'xAI Grok OAuth',
    name: 'Grok 4.20',
    displayName: 'Grok 4.20',
    variant: '',
    quant: '',
    context: '',
    route: '',
    date: '',
    vendor: 'xAI',
    vendorId: 'xai',
    featured: false,
    unavailable: false,
  },
];

const baseProps = { selectedModel: '', reasoningLevel: 'high', approvalMode: 'auto', isStreaming: false };

test('provider 分组折叠 - DOM 必须携带可驱动的状态', async (t) => {
  await t.test('标题带 data-provider / data-collapsed / aria-expanded', () => {
    const html = renderModelPickerTree({ ...baseProps, modelCatalog: CATALOG });
    assert.ok(html.includes('data-provider="cpa"'), '标题必须带 provider slug，否则宿主无法定位');
    assert.ok(html.includes('data-collapsed="false"'), '默认展开必须显式声明');
    assert.ok(html.includes('aria-expanded="true"'), '展开态必须可被读屏与测试读取');
    assert.ok(html.includes('role="button"'), '标题必须是可聚焦控件，支持键盘折叠');
    assert.ok(html.includes('tabindex="0"'), '标题必须能进入 Tab 序');
  });

  await t.test('折叠后该组 aria-expanded=false 且列表 display:none', () => {
    const html = renderModelPickerTree({ ...baseProps, modelCatalog: CATALOG, collapsedProviders: ['cpa'] });
    assert.ok(html.includes('data-collapsed="true"'));
    assert.ok(html.includes('aria-expanded="false"'));
    assert.ok(html.includes('display: none;'), '折叠组的模型容器必须隐藏');
    // 未折叠的组不受影响
    const xaiSection = html.slice(html.indexOf('data-provider="xai-oauth"'));
    assert.ok(xaiSection.includes('display: block;'), '其它分组不得被连带折叠');
  });
});

test('搜索必须无视折叠状态', async (t) => {
  await t.test('折叠组里的模型命中搜索时仍然可见', () => {
    const collapsed = renderModelPickerTree({
      ...baseProps,
      modelCatalog: CATALOG,
      collapsedProviders: ['cpa'],
      modelSearchQuery: 'deepseek',
    });
    assert.ok(collapsed.includes('DeepSeek V4.1 Flash'), '命中的模型必须出现');
    assert.ok(collapsed.includes('display: block;'), '搜索期间不得保留折叠隐藏');
    assert.ok(!collapsed.includes('data-collapsed="true"'), '搜索期间折叠状态被临时忽略');
  });

  await t.test('搜索不命中的 provider 整组消失', () => {
    const html = renderModelPickerTree({ ...baseProps, modelCatalog: CATALOG, modelSearchQuery: 'deepseek' });
    assert.ok(!html.includes('data-provider="xai-oauth"'), '未命中的 provider 不得占位');
  });

  await t.test('空查询恢复折叠状态', () => {
    const html = renderModelPickerTree({
      ...baseProps,
      modelCatalog: CATALOG,
      collapsedProviders: ['cpa'],
      modelSearchQuery: '   ',
    });
    assert.ok(html.includes('data-collapsed="true"'), '空白查询等同无查询，折叠状态回来');
  });
});

test('思考等级二级级联 - 从 footer 下沉到模型行', async (t) => {
  await t.test('输入舱 footer 不再有思考下拉入口', () => {
    const html = renderInputDock({ ...baseProps, modelCatalog: CATALOG, modelMenuOpen: true });
    assert.ok(!html.includes('dock-reasoning-toggle-btn'), '思考按钮必须从输入舱移除');
    assert.ok(!html.includes('dock-reasoning-dropdown'), '旧思考下拉必须移除');
  });

  await t.test('级联面板完整列出五档并标出当前值', () => {
    const html = renderInputDock({ ...baseProps, modelCatalog: CATALOG, modelMenuOpen: true, reasoningLevel: 'max' });
    assert.ok(html.includes('id="model-reasoning-cascade"'), '级联面板必须挂在模型下拉内');
    for (const level of ['default', 'none', 'low', 'high', 'max']) {
      assert.ok(html.includes(`data-level="${level}"`), `缺少等级 ${level}`);
    }
    const activeItem = html.match(/class="model-cascade__item active"[^>]*data-level="([^"]+)"/);
    assert.ok(activeItem, '必须标出当前生效等级');
    assert.equal(activeItem[1], 'max');
  });

  await t.test('默认等级与历史别名保持一致，且只高亮一档', () => {
    const html = renderInputDock({ ...baseProps, modelCatalog: CATALOG, modelMenuOpen: true, reasoningLevel: 'high' });
    const actives = [...html.matchAll(/class="model-cascade__item active"[^>]*data-level="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(actives, ['high'], '同一时刻只能有一档被勾选，否则用户看不出当前等级');
  });

  await t.test('折叠态必须带可辨的视觉弱化与可点击暗示', () => {
    const css = fs.readFileSync(new URL('../../src/styles/conversation.css', import.meta.url), 'utf8');
    assert.match(
      css,
      /\.model-provider-group-header\[data-collapsed="true"\]\s*\{[^}]*opacity/,
      '折叠态必须有整体弱化，否则只靠箭头翻转在 1x 屏看不出来',
    );
    assert.match(
      css,
      /\.model-provider-group-header:hover\s*\{[^}]*background:\s*var\(--card-hover\)/,
      '分组标题必须有 hover 反馈，否则看不出能点',
    );
    assert.match(
      css,
      /\.model-provider-group-header\[data-search-open="true"\][\s\S]*?visibility:\s*hidden/,
      '搜索期间折叠失效，箭头必须隐藏，避免出现点了不动的死控件',
    );
  });

  await t.test('行悬停底色必须由 CSS 承担，模板内不得再写内联 background', () => {
    const html = renderModelPickerTree({ ...baseProps, modelCatalog: CATALOG });
    // 【规则】必须逐行取完整开标签再判：`class="model-option"` 与 `data-model=` 相邻，
    // 若按这两者切片，切出来的只有 20 来个字符，`style` 里的 background 永远不在区间内，
    // 断言恒真——正是这个假绿让「内联 background 压死 CSS hover」溜了过去。
    const rowTags = [...html.matchAll(/<div class="model-option[^"]*"([^>]*)>/g)].map((m) => m[1]);
    assert.equal(rowTags.length, 3, '必须取到全部模型行的开标签');
    rowTags.forEach((attrs, i) => {
      assert.ok(!/background\s*:/.test(attrs), `第 ${i + 1} 行的内联样式不得写 background（会压死 CSS :hover）`);
    });

    const css = fs.readFileSync(new URL('../../src/styles/conversation.css', import.meta.url), 'utf8');
    assert.match(css, /\.model-option\.active\s*\{[^}]*background:\s*var\(--accent-subtle\)/, '选中态底色必须由 CSS 定义');
    assert.match(
      css,
      /\.model-option:not\(\.active\):not\(\.is-locked\):hover[\s\S]{0,80}background:\s*var\(--card-hover\)/,
      '悬停底色必须由 CSS 定义',
    );
  });

  await t.test('级联必须支持键盘：行可聚焦、项可聚焦、aria 语义完整', () => {
    const html = renderModelPickerTree({ ...baseProps, modelCatalog: CATALOG });
    assert.ok(html.includes('role="option"'), '模型行必须是 option 角色');
    assert.ok(html.includes('tabindex="0"'), '模型行必须可聚焦');
    assert.ok(html.includes('aria-haspopup="menu"'), '模型行必须声明有二级菜单');

    const dock = renderInputDock({ ...baseProps, modelCatalog: CATALOG, modelMenuOpen: true, favoriteModels: ['anthropic/claude-opus-5'], recentModels: ['grok-4.20'] });
    assert.ok(dock.includes('role="menu"'), '级联必须是 menu');
    assert.ok(dock.includes('role="menuitemradio"'), '级联项必须是 menuitemradio');
    // 【ARIA 树完整性】option 不能悬空，祖先必须是 listbox，分组容器必须是 group
    assert.match(dock, /id="model-picker-scroll-list"[^>]*role="listbox"/, '列表容器必须是 listbox');
    const providerGroups = dock.match(/class="model-provider-items"[^>]*>/g) ?? [];
    assert.equal(providerGroups.length, 2, '每个 provider 分组都需要独立 group 容器');
    providerGroups.forEach((tag, i) => {
      assert.ok(tag.includes('role="group"') && tag.includes('aria-label='), `第 ${i + 1} 个 provider 容器缺 role="group" 或 aria-label`);
    });
    const sections = dock.match(/class="model-picker-section"[^>]*>/g) ?? [];
    assert.equal(sections.length, 2, '收藏与最近区必须存在');
    sections.forEach((tag, i) => {
      assert.ok(tag.includes('role="group"') && tag.includes('aria-label='), `收藏/最近第 ${i + 1} 区缺 role="group" 或 aria-label`);
    });
    // 声明了 menuitemradio 就必须兑现键盘契约：可聚焦
    const items = dock.match(/class="model-cascade__item[^"]*"[^>]*/g) ?? [];
    assert.equal(items.length, 5);
    items.forEach((item, i) => assert.ok(item.includes('tabindex="0"'), `第 ${i + 1} 个级联项必须可聚焦`));
  });

  await t.test('renderInputDock 的 div 开闭标签必须严格配对（净深度 === 0）', () => {
    for (const opts of [
      { modelMenuOpen: false, notice: '' },
      { modelMenuOpen: true, notice: '告警测试', favoriteModels: ['anthropic/claude-opus-5'] },
    ]) {
      const dock = renderInputDock({ ...baseProps, modelCatalog: CATALOG, ...opts });
      const opens = (dock.match(/<div\b/g) ?? []).length;
      const closes = (dock.match(/<\/div>/g) ?? []).length;
      assert.equal(opens, closes, `div 开闭不匹配（opens=${opens}, closes=${closes}），多/少闭合标签会破坏外层宿主容器`);
    }
  });

  await t.test('触发按钮 aria-haspopup/aria-expanded 与锁定行 aria-haspopup 语义一致', () => {
    const closed = renderInputDock({ ...baseProps, modelCatalog: CATALOG, modelMenuOpen: false });
    assert.match(closed, /id="dock-model-selector-btn"[^>]*aria-haspopup="listbox"/);
    assert.match(closed, /id="dock-model-selector-btn"[^>]*aria-expanded="false"/);

    const opened = renderInputDock({
      ...baseProps,
      modelCatalog: [
        ...CATALOG,
        { ...CATALOG[0], id: 'locked/model-x', name: 'Locked X', displayName: 'Locked X', unavailable: true },
      ],
      modelMenuOpen: true,
    });
    assert.match(opened, /id="dock-model-selector-btn"[^>]*aria-expanded="true"/);
    const lockedTag = opened.match(/<div class="model-option[^"]*"[^>]*data-model="locked\/model-x"[^>]*>/)?.[0] ?? '';
    assert.ok(lockedTag.length > 0, '必须找到锁定行');
    assert.ok(!lockedTag.includes('aria-haspopup="menu"'), '锁定行永远弹不出级联，不得声明 aria-haspopup="menu"');

    const css = fs.readFileSync(new URL('../../src/styles/conversation.css', import.meta.url), 'utf8');
    assert.match(css, /\.model-dropdown-menu\s*\{[^}]*max-width:\s*calc\(100vw - 24px\)/, '窄屏下拉必须限宽防水平溢出');
    assert.match(css, /\.model-cascade--inset\s*\{[^}]*right:\s*8px/, '双侧空间不足时级联必须有内缩停靠样式');
  });

  await t.test('移除思考入口后，发送键必须留在右侧紧凑组内（不留中间空洞）', () => {
    const dock = renderInputDock({ ...baseProps, modelCatalog: CATALOG, modelMenuOpen: false });
    const startMarker = '<div class="composer-dock__footer-group composer-dock__footer-group--end">';
    const startAt = dock.indexOf(startMarker);
    assert.ok(startAt > 0, '必须存在右端紧凑组');
    const afterStart = dock.slice(startAt);
    const sendAt = afterStart.indexOf('id="dock-send-btn"');
    assert.ok(sendAt > 0, '发送键必须存在');
    // 从 --end 自身开标签起算：到发送键为止，未闭合的 div 只能等于 1（即 --end 自身）
    const beforeSend = afterStart.slice(0, sendAt);
    const openDivs = (beforeSend.match(/<div\b/g) ?? []).length;
    const closeDivs = (beforeSend.match(/<\/div>/g) ?? []).length;
    assert.equal(openDivs - closeDivs, 1, '发送键必须紧包在 composer-dock__footer-group--end 内部');
  });

  await t.test('思考等级历史别名必须归一，五档永不全暗', () => {
    const activeOf = (level) => {
      const html = renderInputDock({ ...baseProps, modelCatalog: CATALOG, modelMenuOpen: true, reasoningLevel: level });
      return [...html.matchAll(/class="model-cascade__item active"[^>]*data-level="([^"]+)"/g)].map((m) => m[1]);
    };
    assert.deepEqual(activeOf('off'), ['none'], 'off 必须归一到 none');
    assert.deepEqual(activeOf('medium'), ['high'], 'medium 必须归一到 high');
    assert.deepEqual(activeOf('none'), ['none']);
    assert.deepEqual(activeOf('max'), ['max']);
    assert.deepEqual(activeOf(''), ['default'], '空串必须回退 default，不得五档全暗');
  });

  await t.test('每行带二级菜单可发现性提示', () => {
    const html = renderModelPickerTree({ ...baseProps, modelCatalog: CATALOG });
    const cues = html.match(/class="model-option__cascade"/g) ?? [];
    assert.equal(cues.length, 3, '每个模型行都要有悬停提示');
  });
});
