import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveDockModelLabel,
  resolveModelPickerRows,
  renderInputDock,
  renderModelPickerTree,
  hasDockSnapshotChanged,
} from '../../dist/components/InputDock/InputDock.js';

/** 造一条目录条目，只填本测试关心的字段。 */
function entry(overrides) {
  const id = overrides.id;
  return {
    id,
    providerSlug: overrides.providerSlug ?? 'cpa',
    providerName: overrides.providerName ?? 'cpa',
    name: overrides.name ?? id,
    variant: overrides.variant ?? '',
    quant: overrides.quant ?? '',
    context: overrides.context ?? '',
    route: overrides.route ?? '',
    date: overrides.date ?? '',
    vendor: overrides.vendor ?? '',
    displayName: overrides.displayName ?? overrides.name ?? id,
    featured: false,
    unavailable: false,
    ...overrides,
  };
}

const baseProps = {
  reasoningLevel: 'default',
  approvalMode: 'auto',
  isStreaming: false,
};

test('resolveDockModelLabel - 输入舱标签必须显示完整可读名', async (t) => {
  await t.test('1. 目录命中时使用完整 displayName，而非裸 ID', () => {
    const catalog = [entry({ id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', variant: 'Flash' })];
    const label = resolveDockModelLabel({
      selectedModel: 'gemini-3.8-flash',
      modelCatalog: catalog,
      currentProvider: 'cpa',
    });
    assert.equal(label, 'Gemini 3.8 Flash');
    assert.ok(!label.includes('/'), '标签不得包含模型 ID 的斜杠前缀');
  });

  await t.test('2. 变体词必须留在标签里（不得只剩主体名）', () => {
    const catalog = [
      entry({ id: 'anthropic/claude-opus-4.8-fast', name: 'Opus 4.8 Fast', variant: 'Fast' }),
    ];
    const label = resolveDockModelLabel({
      selectedModel: 'anthropic/claude-opus-4.8-fast',
      modelCatalog: catalog,
      currentProvider: 'nous',
    });
    assert.equal(label, 'Opus 4.8 Fast');
    assert.ok(label.includes('Fast'), '标签必须包含 Fast');
  });

  await t.test('3. currentProvider 用于在多 provider 同名模型中消歧', () => {
    const catalog = [
      entry({ id: 'gemini-3.8-flash', providerSlug: 'cpa', name: 'CPA Gemini 3.8 Flash' }),
      entry({ id: 'gemini-3.8-flash', providerSlug: 'nous', name: 'Nous Gemini 3.8 Flash' }),
    ];
    assert.equal(
      resolveDockModelLabel({ selectedModel: 'gemini-3.8-flash', modelCatalog: catalog, currentProvider: 'nous' }),
      'Nous Gemini 3.8 Flash',
    );
    assert.equal(
      resolveDockModelLabel({ selectedModel: 'gemini-3.8-flash', modelCatalog: catalog, currentProvider: 'cpa' }),
      'CPA Gemini 3.8 Flash',
    );
  });

  await t.test('4. provider=auto 时退化为按 ID 匹配', () => {
    const catalog = [entry({ id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' })];
    assert.equal(
      resolveDockModelLabel({ selectedModel: 'gemini-3.8-flash', modelCatalog: catalog, currentProvider: 'auto' }),
      'Gemini 3.8 Flash',
    );
  });

  await t.test('5. 目录未命中时回退 core 派生名，绝不裸 ID 直出', () => {
    const label = resolveDockModelLabel({
      selectedModel: 'group/deepseek-v4.1-flash',
      modelCatalog: [],
      currentProvider: 'cpa',
    });
    assert.equal(label, 'DeepSeek V4.1 Flash');
    assert.ok(!label.startsWith('group/'));
  });

  await t.test('6. selectedModel 为空时回退 i18n 占位文案', () => {
    const label = resolveDockModelLabel({ selectedModel: '', modelCatalog: [] });
    assert.ok(label.length > 0);
    assert.ok(!label.includes('/'));
  });

  await t.test('7. 目录完全缺失（旧调用方）时仍派生出完整可读名', () => {
    assert.equal(resolveDockModelLabel({ selectedModel: 'openai/gpt-6-astra-pro-fast' }), 'GPT-6 Astra Pro Fast');
  });
});

test('resolveModelPickerRows - 选择器行三数据源收敛', async (t) => {
  await t.test('1. modelCatalog 优先，且保留 contextLength / supportsVision', () => {
    const rows = resolveModelPickerRows({
      modelCatalog: [
        entry({
          id: 'anthropic/claude-opus-5',
          name: 'Opus 5',
          providerName: 'Nous Portal',
          contextLength: 200000,
          supportsVision: true,
        }),
      ],
      modelDetails: [{ id: 'ignored', provider: 'X', name: 'Ignored', displayName: 'Ignored' }],
      models: ['also-ignored'],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'anthropic/claude-opus-5');
    assert.equal(rows[0].provider, 'cpa');
    assert.equal(rows[0].providerName, 'Nous Portal', 'provider 展示名必须透传，供分组标题使用');
    assert.equal(rows[0].contextLength, 200000);
    assert.equal(rows[0].supportsVision, true);
  });

  await t.test('2. catalog 分支不得丢弃能力与可选性信息', () => {
    const rows = resolveModelPickerRows({
      modelCatalog: [
        entry({ id: 'a/b', contextLength: 128000, supportsVision: true, unavailable: true, featured: true }),
      ],
    });
    assert.notEqual(rows[0].contextLength, undefined);
    assert.notEqual(rows[0].supportsVision, undefined);
    assert.equal(rows[0].unavailable, true);
    assert.equal(rows[0].featured, true);
  });

  await t.test('3. modelDetails 分支重派生，剥离历史 provider 尾巴且保持完整名', () => {
    const rows = resolveModelPickerRows({
      modelDetails: [
        {
          id: 'anthropic/claude-3-7-sonnet',
          provider: 'Anthropic',
          name: 'Claude 3.7 Sonnet',
          displayName: 'Claude 3.7 Sonnet (Anthropic)',
          contextLength: 200000,
          supportsVision: true,
        },
        { id: 'openai/gpt-4o', provider: 'OpenAI', name: 'GPT-4o', displayName: 'GPT-4o' },
      ],
    });
    assert.equal(rows[0].displayName, 'Sonnet 3.7');
    assert.equal(rows[0].name, 'Sonnet 3.7');
    assert.equal(rows[0].vendor, 'Anthropic');
    assert.equal(rows[0].contextLength, 200000);
    assert.equal(rows[0].supportsVision, true);
    assert.equal(rows[1].displayName, 'GPT-4o');
  });

  await t.test('4. 模型名本身带括号时不被误判', () => {
    const rows = resolveModelPickerRows({
      modelDetails: [{ id: 'qwen/qwen3-32b', provider: 'Qwen', name: 'Qwen3 (32B)', displayName: 'Qwen3 (32B)' }],
    });
    assert.ok(rows[0].displayName.includes('32B'));
  });

  await t.test('5. 仅有裸 models 时按 DEFAULT provider 派生完整名', () => {
    const rows = resolveModelPickerRows({ models: ['google/gemini-3.8-flash'] });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].provider, 'DEFAULT');
    assert.equal(rows[0].name, 'Gemini 3.8 Flash');
    assert.equal(rows[0].variant, 'Flash');
    assert.ok(!rows[0].displayName.startsWith('google/'));
  });

  await t.test('6. 三源全空时返回空数组', () => {
    assert.deepEqual(resolveModelPickerRows({}), []);
    assert.deepEqual(resolveModelPickerRows({ modelCatalog: [], modelDetails: [], models: [] }), []);
  });
});

test('renderInputDock / renderModelPickerTree - 渲染面不泄露裸 ID', async (t) => {
  await t.test('1. 输入舱主标签必须渲染完整可读名', () => {
    const html = renderInputDock({
      ...baseProps,
      selectedModel: 'group/deepseek-v4.1-flash',
      modelCatalog: [entry({ id: 'group/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', variant: 'Flash' })],
      currentProvider: 'cpa',
      models: ['group/deepseek-v4.1-flash'],
    });
    assert.ok(html.includes('DeepSeek V4.1 Flash'), '标签必须显示完整可读名');
    assert.ok(!html.includes('>group/deepseek-v4.1-flash<'), '标签不得把裸 ID 作为文本渲染');
  });

  await t.test('2. 标签值经过 HTML 转义（防注入）', () => {
    const html = renderInputDock({
      ...baseProps,
      selectedModel: 'x/<img src=x onerror=alert(1)>',
      modelCatalog: [
        entry({ id: 'x/<img src=x onerror=alert(1)>', name: '<img src=x onerror=alert(1)>' }),
      ],
      models: ['x/<img src=x onerror=alert(1)>'],
    });
    assert.ok(!html.includes('<img src=x'), 'HTML 必须被转义');
    assert.ok(html.includes('&lt;img'));
  });

  await t.test('3. 选择器行渲染完整名字 + 变体标签', () => {
    const html = renderModelPickerTree({
      ...baseProps,
      selectedModel: 'anthropic/claude-opus-4.8-fast',
      modelCatalog: [
        entry({
          id: 'anthropic/claude-opus-4.8-fast',
          name: 'Opus 4.8 Fast',
          variant: 'Fast',
          providerSlug: 'nous',
          providerName: 'Nous Portal',
        }),
      ],
      currentProvider: 'nous',
    });
    assert.ok(html.includes('Opus 4.8 Fast'), '名字必须完整包含 Fast');
    assert.ok(html.includes('Fast'), '变体标签必须渲染');
    assert.ok(!html.includes('>anthropic/claude-opus-4.8-fast<'));
  });

  await t.test('4. 标签声明 flex-shrink:0，防止窄容器压扁裁切', () => {
    const html = renderModelPickerTree({
      ...baseProps,
      selectedModel: 'qwen/qwen3-32b-Q4_K_M',
      modelCatalog: [
        entry({ id: 'qwen/qwen3-32b-Q4_K_M', name: 'Qwen3 32B Q4_K_M', quant: 'Q4_K_M', providerSlug: 'llamacpp' }),
      ],
      currentProvider: 'llamacpp',
    });
    assert.ok(html.includes('flex-shrink: 0'), '标签必须禁止收缩');
    assert.ok(html.includes('Q4_K_M'));
  });

  await t.test('5. 标签字号只使用设计系统七档内的 --fs-micro', () => {
    const html = renderModelPickerTree({
      ...baseProps,
      selectedModel: 'a/b',
      modelCatalog: [entry({ id: 'a/b', name: 'AB Fast', variant: 'Fast' })],
    });
    assert.ok(html.includes('var(--fs-micro)'));
    assert.ok(!html.includes('--fs-overline'), '--fs-overline 是规格外第 8 档，禁止使用');
  });

  await t.test('6. 空标签不产生空 span（计数可证伪）', () => {
    const html = renderModelPickerTree({
      ...baseProps,
      selectedModel: 'a/b',
      modelCatalog: [entry({ id: 'a/b', name: 'AB' })],
    });
    const badgeCount = (html.match(/line-height: 1\.4; padding: 0 4px; border-radius: 4px;/g) ?? []).length;
    assert.equal(badgeCount, 0, '无变体/量化/上下文时不得渲染任何标签');
  });

  await t.test('6b. 有变体时恰好渲染 1 枚标签', () => {
    const html = renderModelPickerTree({
      ...baseProps,
      selectedModel: 'a/b',
      modelCatalog: [entry({ id: 'a/b', name: 'AB Fast', variant: 'Fast' })],
    });
    const badgeCount = (html.match(/line-height: 1\.4; padding: 0 4px; border-radius: 4px;/g) ?? []).length;
    assert.equal(badgeCount, 1);
  });

  await t.test('7. 网关标记 unavailable 的模型必须渲染禁用态', () => {
    const html = renderModelPickerTree({
      ...baseProps,
      selectedModel: 'a/ok',
      modelCatalog: [
        entry({ id: 'a/ok', name: 'OK' }),
        entry({ id: 'a/pro', name: 'Pro', unavailable: true, providerWarning: '需要升级订阅' }),
      ],
    });
    assert.ok(html.includes('data-locked="true"'));
    assert.ok(html.includes('cursor: not-allowed'));
    assert.ok(html.includes('不可用'));
    assert.ok(html.includes('需要升级订阅'));
  });

  await t.test('8. 可选模型不得被误标为锁定', () => {
    const html = renderModelPickerTree({
      ...baseProps,
      selectedModel: 'a/ok',
      modelCatalog: [entry({ id: 'a/ok', name: 'OK', unavailable: false })],
    });
    assert.ok(!html.includes('data-locked="true"'));
    assert.ok(html.includes('data-locked="false"'));
  });

  await t.test('10. 分组标题必须用 provider 展示名，而不是大写 slug', () => {
    const html = renderModelPickerTree({
      ...baseProps,
      selectedModel: 'x',
      modelCatalog: [
        entry({ id: 'anthropic/claude-opus-5', providerSlug: 'nous', providerName: 'Nous Portal', name: 'Opus 5' }),
      ],
      currentProvider: 'nous',
    });
    assert.ok(html.includes('Nous Portal'), '必须显示 provider 展示名');
    assert.ok(!html.includes('>NOUS<'), '不得把 slug 大写后当标题');
  });

  await t.test('11. 标签前景/背景必须构成可读对比', () => {
    const html = renderModelPickerTree({
      ...baseProps,
      selectedModel: 'a/b',
      modelCatalog: [entry({ id: 'a/b', name: 'AB Fast', variant: 'Fast' })],
    });
    assert.ok(!html.includes('color: var(--primary); background: var(--primary-subtle)'));
    assert.ok(!html.includes('color: var(--accent); background: var(--accent-subtle)'));
  });
});

test('hasDockSnapshotChanged - 新增比较分支必须真的参与判定', async (t) => {
  const base = {
    selectedModel: 'm1',
    currentProvider: 'p1',
    reasoningLevel: 'default',
    approvalMode: 'auto',
    isStreaming: false,
    disabled: false,
    modelMenuOpen: false,
    notice: '',
    modelCount: 1,
    modelCatalogHash: 'p1:m1:M One',
    modelSearchQuery: '',
    recentModelsHash: '',
    favoriteModelsHash: '',
  };

  await t.test('1. 快照为 null 时必须判定为变化', () => {
    assert.equal(hasDockSnapshotChanged(null, base), true);
  });

  await t.test('2. 完全相同时判定为未变化', () => {
    assert.equal(hasDockSnapshotChanged(base, { ...base }), false);
  });

  await t.test('3. currentProvider 变化必须触发重绘', () => {
    assert.equal(hasDockSnapshotChanged(base, { ...base, currentProvider: 'p2' }), true);
  });

  await t.test('4. modelCatalogHash 变化必须触发重绘', () => {
    assert.equal(hasDockSnapshotChanged(base, { ...base, modelCatalogHash: 'p1:m1:M One Renamed' }), true);
  });

  await t.test('5. 仅 selectedModel 变化必须触发重绘', () => {
    assert.equal(hasDockSnapshotChanged(base, { ...base, selectedModel: 'm2' }), true);
  });
});
