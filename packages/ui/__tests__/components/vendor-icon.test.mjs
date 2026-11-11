/**
 * 模型厂商图标渲染单测 (Vendor Icon)
 *
 * 【覆盖目标】
 *   1. 三档渲染形态的判定必须与资产清单一致（彩色可读 / 双轨 / 仅 mono）；
 *   2. 判不出厂商时必须是首字母 badge，不许留白、不许回退 emoji；
 *   3. 清单里标记「有彩色版」的 slug，磁盘上必须真有那个文件——否则线上就是破图，
 *      而破图在字符串测试里很难被发现，只能靠这条一致性断言兜住。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  hasVendorIcon,
  renderModelVendorIcon,
  renderProviderVendorIcon,
  renderVendorIcon,
  resolveVendorIconVariant,
  vendorIconBadgeLetter,
} from '../../dist/lib/vendorIcon.js';
import { VENDOR_ICON_ASSETS } from '../../dist/icons/vendorIconAssets.js';
import { MODEL_VENDOR_IDS } from '@hermes-flux/core';
import { renderInputDock, renderModelPickerTree, resolveModelPickerRows } from '../../dist/components/InputDock/InputDock.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ICON_DIR = path.resolve(HERE, '..', '..', 'src', 'icons', 'lobe');

test('resolveVendorIconVariant - 四档形态判定', async (t) => {
  await t.test('只有 mono 的厂商（标识本身是黑色）永远 mono', () => {
    assert.equal(resolveVendorIconVariant('anthropic'), 'mono');
    assert.equal(resolveVendorIconVariant('openai'), 'mono');
    assert.equal(resolveVendorIconVariant('xai'), 'mono');
    assert.equal(resolveVendorIconVariant('moonshot'), 'mono');
  });

  await t.test('彩色版两侧都可读的直接彩色', () => {
    assert.equal(resolveVendorIconVariant('deepseek'), 'color');
    assert.equal(resolveVendorIconVariant('zhipu'), 'color');
  });

  await t.test('彩色版只在浅色可读的走双轨（深色出 mono）', () => {
    assert.equal(resolveVendorIconVariant('qwen'), 'dual');
    assert.equal(resolveVendorIconVariant('tencent'), 'dual');
  });

  await t.test('彩色版只在深色可读的走反向双轨（浅色出 mono）', () => {
    // 荧光绿 OpenRouter、亮绿 NVIDIA：白底对比度不足，只能深色出彩色
    assert.equal(resolveVendorIconVariant('openrouter'), 'dual-inverse');
    assert.equal(resolveVendorIconVariant('nvidia'), 'dual-inverse');
  });

  await t.test('彩色版两侧都不可读时退 mono', () => {
    // 【为什么注入桩】采用「多数色值达标」判据后，真实清单里已不存在两侧都不可读的品牌；
    // 这条分支因此变成纯防御代码。不注入就等于没人验证过它——把 `return 'mono'` 改成
    // `return 'color'` 也不会有人发现，直到上游某个荧光品牌真的两侧都隐形。
    const slug = '__fixture_both_unsafe__';
    VENDOR_ICON_ASSETS[slug] = { color: true, mono: true, colorDarkSafe: false, colorLightSafe: false };
    try {
      assert.equal(resolveVendorIconVariant(slug), 'mono');
      const html = renderVendorIcon({ vendorId: slug, label: 'Fixture' });
      assert.ok(!html.includes('<img'), '两侧都不可读时不得输出彩色 img');
      assert.ok(html.includes('vendor-icon__mono'), '必须退到 mono');
    } finally {
      delete VENDOR_ICON_ASSETS[slug];
    }
  });

  await t.test('未知或空 slug 一律 badge', () => {
    assert.equal(resolveVendorIconVariant(''), 'badge');
    assert.equal(resolveVendorIconVariant('not-a-real-vendor'), 'badge');
  });
});

test('资产清单与磁盘文件必须一致（防破图）', async (t) => {
  const slugs = Object.keys(VENDOR_ICON_ASSETS);
  assert.ok(slugs.length > 300, `清单厂商数量异常：${slugs.length}`);

  const missing = [];
  for (const slug of slugs) {
    const asset = VENDOR_ICON_ASSETS[slug];
    if (asset.mono && !fs.existsSync(path.join(ICON_DIR, `${slug}.svg`))) missing.push(`${slug}.svg`);
    if (asset.color && !fs.existsSync(path.join(ICON_DIR, `${slug}-color.svg`))) missing.push(`${slug}-color.svg`);
  }
  assert.deepEqual(missing, [], `清单声明存在但磁盘缺失的图标：${missing.slice(0, 5).join(', ')}`);

  // 反向必须**按变体维度**分别校验：只按 slug 归并会漏掉「清单说没有彩色版、磁盘却有」的漂移，
  // 症状是彩色资产被静默闲置（浅色皮肤白白退化 mono），既不破图也不报错。
  const unregistered = [];
  for (const name of fs.readdirSync(ICON_DIR)) {
    if (!name.endsWith('.svg')) continue;
    if (name.includes('-text') || name.includes('-brand')) continue;
    const isColor = name.endsWith('-color.svg');
    const slug = name.replace(/-color\.svg$/, '').replace(/\.svg$/, '');
    const asset = VENDOR_ICON_ASSETS[slug];
    if (!asset) unregistered.push(`${name}（整条 slug 未登记）`);
    else if (isColor && !asset.color) unregistered.push(`${name}（清单 color=false）`);
    else if (!isColor && !asset.mono) unregistered.push(`${name}（清单 mono=false）`);
  }
  assert.deepEqual(unregistered, [], `磁盘有文件但清单声明相反：${unregistered.slice(0, 5).join(', ')}`);
});

test('core 已知厂商 slug 必须全部能在图标清单里查到', async (t) => {
  await t.test('跨包一致性：core 说得出厂商名，ui 就必须查得到图标', () => {
    const missing = MODEL_VENDOR_IDS.filter((slug) => !VENDOR_ICON_ASSETS[slug]);
    assert.deepEqual(
      missing,
      [],
      `core 的厂商 slug 在 UI 清单里缺失（会静默降级为首字母徽标）：${missing.join(', ')}`,
    );
  });

  await t.test('清单反查：每个 core 厂商都至少有一个可用变体', () => {
    for (const slug of MODEL_VENDOR_IDS) {
      const asset = VENDOR_ICON_ASSETS[slug];
      assert.ok(asset.mono || asset.color, `${slug} 在清单里没有任何可用变体`);
    }
  });

  await t.test('集合自身完整性：不漏关键厂商、不含空串、无重复、已排序', () => {
    // 集合若自身缩小，跨包一致性断言会「自己跟自己对齐」而恒绿，必须单独钉住内容。
    for (const slug of ['anthropic', 'openai', 'google', 'deepseek', 'qwen', 'zhipu', 'xai', 'xiaomimimo']) {
      assert.ok(MODEL_VENDOR_IDS.includes(slug), `MODEL_VENDOR_IDS 缺少 ${slug}`);
    }
    assert.ok(!MODEL_VENDOR_IDS.includes(''), '空 slug 不得进入集合');
    assert.equal(new Set(MODEL_VENDOR_IDS).size, MODEL_VENDOR_IDS.length, '集合不得含重复项');
    assert.deepEqual([...MODEL_VENDOR_IDS], [...MODEL_VENDOR_IDS].sort(), '集合必须已排序');
  });
});

test('renderVendorIcon - 三种形态输出的节点结构', async (t) => {
  await t.test('mono：无 img，用 CSS mask 变量指向 mono 文件', () => {
    const html = renderVendorIcon({ vendorId: 'openai', label: 'OpenAI' });
    assert.ok(html.includes('vendor-icon__mono'), '必须输出 mono 节点');
    assert.ok(!html.includes('<img'), 'mono 形态不应输出 img');
    assert.ok(html.includes("icons/lobe/openai.svg"), '必须指向 mono SVG');
    assert.ok(html.includes('title="OpenAI"'), '必须带厂商名 title');
  });

  await t.test('color：输出单个 img，指向 -color 文件', () => {
    const html = renderVendorIcon({ vendorId: 'deepseek', label: 'DeepSeek' });
    assert.ok(html.includes('<img'), '必须输出 img');
    assert.ok(html.includes('deepseek-color.svg'), '必须指向彩色 SVG');
    assert.ok(!html.includes('vendor-icon__mono'), '可读彩色不应再挂 mono 节点');
  });

  await t.test('dual：同时输出彩色与 mono，由 CSS 按皮肤切换', () => {
    const html = renderVendorIcon({ vendorId: 'qwen', label: 'Qwen' });
    assert.ok(html.includes('vendor-icon--dual'), '必须带 dual 标记');
    assert.ok(!html.includes('vendor-icon--dual-inverse'), '浅色可读的不得标成反向双轨');
    assert.ok(html.includes('qwen-color.svg'), '必须包含彩色版');
    assert.ok(html.includes('qwen.svg'), '必须包含 mono 版');
    assert.ok(html.indexOf('<img') < html.indexOf('vendor-icon__mono'), '彩色节点在前，mono 在后');
  });

  await t.test('dual-inverse：深色出彩色、浅色出 mono', () => {
    const html = renderVendorIcon({ vendorId: 'openrouter', label: 'OpenRouter' });
    assert.ok(html.includes('vendor-icon--dual-inverse'), '必须标记反向双轨');
    assert.ok(html.includes('openrouter-color.svg') && html.includes('openrouter.svg'));
  });

  await t.test('badge：无图标厂商渲染首字母，尺寸与图标一致', () => {
    const html = renderVendorIcon({ vendorId: '', label: 'InclusionAI', size: 14 });
    assert.ok(html.includes('vendor-icon--badge'), '必须走 badge 分支');
    assert.ok(html.includes('>I<'), '必须渲染首字母');
    assert.ok(html.includes('width:14px'), 'badge 必须与图标同尺寸');
  });
});

test('renderVendorIcon - 尺寸与转义', async (t) => {
  await t.test('尺寸夹在 10~20 之间，防止糊成色块或撑破行', () => {
    assert.ok(renderVendorIcon({ vendorId: 'google', size: 4 }).includes('width:10px'));
    assert.ok(renderVendorIcon({ vendorId: 'google', size: 99 }).includes('width:20px'));
    assert.ok(renderVendorIcon({ vendorId: 'google' }).includes('width:14px'));
  });

  await t.test('厂商名里的引号必须转义，禁止污染 title 属性', () => {
    const html = renderVendorIcon({ vendorId: '', label: 'Evil "><script>' });
    assert.ok(!html.includes('"><script>'), '未转义的引号会截断属性');
    assert.ok(html.includes('&quot;'), '引号必须转义');
  });

  await t.test('首字母 badge 对中文厂商名同样成立', () => {
    assert.equal(vendorIconBadgeLetter('智谱', ''), '智');
    assert.equal(vendorIconBadgeLetter('', 'deepseek'), 'D');
    assert.equal(vendorIconBadgeLetter('', ''), '?');
  });
});

test('renderModelVendorIcon / renderProviderVendorIcon - 两个维度的入口', async (t) => {
  await t.test('模型维度按 ID 自动判定厂商', () => {
    const html = renderModelVendorIcon('group/deepseek-v4.1-flash', 'cpa');
    assert.ok(html.includes('deepseek-color.svg'), '`group/` 前缀不得干扰厂商判定');
  });

  await t.test('provider 维度只认完整厂商段', () => {
    assert.ok(renderProviderVendorIcon('xai-oauth', 'xAI Grok OAuth').includes('xai'));
    // cpa 是接入入口：既不能硬套厂商 logo，也不该补一个与右侧 provider 名重复的首字母方块
    assert.equal(renderProviderVendorIcon('cpa', 'cpa'), '', '分组标题判不出厂商时应省略图标');
  });

  await t.test('hasVendorIcon 与清单口径一致', () => {
    assert.equal(hasVendorIcon('openai'), true);
    assert.equal(hasVendorIcon(''), false);
    assert.equal(hasVendorIcon('not-a-real-vendor'), false);
  });
});

test('模型选择器接线 - 图标替换 emoji', async (t) => {
  const catalog = [
    {
      id: 'group/deepseek-v4.1-flash',
      providerSlug: 'cpa',
      providerName: 'cpa',
      name: 'DeepSeek V4.1 Flash',
      variant: 'Flash',
      quant: '',
      context: '',
      route: '',
      date: '',
      vendor: 'DeepSeek',
      vendorId: 'deepseek',
      displayName: 'DeepSeek V4.1 Flash',
      featured: false,
      unavailable: false,
    },
    {
      id: 'gemini-3.8-flash',
      providerSlug: 'cpa',
      providerName: 'cpa',
      name: 'Gemini 3.8 Flash',
      variant: 'Flash',
      quant: '',
      context: '',
      route: '',
      date: '',
      vendor: 'Google',
      vendorId: 'google',
      displayName: 'Gemini 3.8 Flash',
      featured: false,
      unavailable: false,
    },
  ];

  await t.test('每行左侧渲染厂商图标', () => {
    const html = renderModelPickerTree({ modelCatalog: catalog, selectedModel: 'gemini-3.8-flash' });
    assert.ok(html.includes('deepseek-color.svg'), 'DeepSeek 行必须有图标');
    assert.ok(html.includes('google-color.svg'), 'Gemini 行必须有图标');
    // 图标必须在名字之前，眼睛先看到品牌再看型号
    assert.ok(html.indexOf('google-color.svg') < html.indexOf('Gemini 3.8 Flash'));
  });

  await t.test('分组标题不再使用 emoji，且不在标题里补首字母冗余徽标', () => {
    const html = renderModelPickerTree({ modelCatalog: catalog, selectedModel: '' });
    for (const emoji of ['🐋', '🧠', '⚡', '🤖', '✦', '📱']) {
      assert.ok(!html.includes(emoji), `分组标题不得再出现 emoji：${emoji}`);
    }
    // `cpa` 判不出厂商：标题右侧已经写着 cpa，左侧不再补一个 C 方块
    assert.ok(html.includes('model-provider-group-header'), '分组结构必须存在');
    const headerSection = html.slice(html.indexOf('model-provider-group-header'), html.indexOf('model-provider-items'));
    assert.ok(!headerSection.includes('vendor-icon--badge'), '分组标题不得出现首字母冗余徽标');
  });

  await t.test('无图标厂商的模型行仍然降级徽标（不能留白）', () => {
    const html = renderModelPickerTree({
      modelCatalog: [
        { ...catalog[0], id: 'ling-2', name: 'Ling 2', displayName: 'Ling 2', vendor: 'InclusionAI', vendorId: '' },
      ],
      selectedModel: '',
    });
    assert.ok(html.includes('vendor-icon--badge'), '模型行判不出厂商时必须降级');
    assert.ok(html.includes('>I<'), '降级徽标取厂商名首字母');
  });

  await t.test('modelDetails 历史数据源同样派生 vendorId', () => {
    const rows = resolveModelPickerRows({
      modelDetails: [{ id: 'deepseek/deepseek-v4.1-flash', provider: 'cpa', name: 'DeepSeek V4.1 Flash' }],
    });
    assert.equal(rows[0].vendorId, 'deepseek');
  });

  await t.test('裸 models 数据源同样派生 vendorId', () => {
    const rows = resolveModelPickerRows({ models: ['zai/glm-5.2'] });
    assert.equal(rows[0].vendorId, 'zhipu');
  });

  await t.test('输入舱触发按钮展示当前模型厂商图标，且 title 用展示名而非内部 slug', () => {
    const html = renderInputDock({
      reasoningLevel: 'default',
      approvalMode: 'auto',
      isStreaming: false,
      selectedModel: 'anthropic/claude-opus-5',
      modelCatalog: [
        {
          ...catalog[0],
          id: 'anthropic/claude-opus-5',
          name: 'Opus 5',
          displayName: 'Opus 5',
          vendor: 'Anthropic',
          vendorId: 'anthropic',
        },
      ],
    });
    assert.ok(html.includes('icons/lobe/anthropic.svg'), '触发按钮必须显示厂商 mono 图标');
    assert.ok(html.includes('title="Anthropic"'), 'title 必须是展示名');
    assert.ok(!html.includes('title="anthropic"'), '禁止把内部 slug 暴露成 tooltip');
  });

  await t.test('未选模型时保留齿轮图标（通用入口），不硬套厂商', () => {
    const html = renderInputDock({ reasoningLevel: 'default', approvalMode: 'auto', isStreaming: false });
    assert.ok(html.includes('dock-model-selector-btn'), '触发按钮必须存在');
    assert.ok(html.includes('M15 2v2M15 20v2'), '无模型时必须回退齿轮 svg');
  });
});
