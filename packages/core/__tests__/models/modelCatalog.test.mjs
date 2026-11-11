import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseModelDisplay,
  formatModelDisplayName,
  resolveModelVendor,
  stripProviderPrefix,
  modelVariantTag,
} from '../../dist/models/modelNaming.js';
import {
  buildModelCatalogView,
  normalizeModelCatalog,
  findCatalogEntry,
  modelLabelFromCatalog,
  modelCatalogFingerprint,
  groupCatalogByProvider,
  readCurrentSelection,
} from '../../dist/models/modelCatalog.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, '..', 'fixtures', 'gateway', 'model_options.json');

function loadGatewayFixture() {
  return JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
}

test('modelNaming - 完整名字：ID 里的词一个都不能少', async (t) => {
  await t.test('1. 变体后缀必须留在名字里（不得只做标签）', () => {
    assert.equal(formatModelDisplayName('gemini-3.8-flash'), 'Gemini 3.8 Flash');
    assert.equal(formatModelDisplayName('anthropic/claude-opus-4.8-fast'), 'Opus 4.8 Fast');
    assert.equal(formatModelDisplayName('openai/gpt-6-astra-pro-fast'), 'GPT-6 Astra Pro Fast');
    assert.equal(formatModelDisplayName('qwen/qwen3.8-flash'), 'Qwen3.8 Flash');
  });

  await t.test('2. 名字与标签不重复拼接（禁止 `Flash · Flash`）', () => {
    const name = formatModelDisplayName('gemini-3.8-flash');
    assert.equal(name, 'Gemini 3.8 Flash');
    assert.ok(!name.includes('·'), '名字里不得出现额外分隔拼接');
    assert.equal(name.match(/Flash/g).length, 1, 'Flash 只能出现一次');
  });

  await t.test('3. Anthropic 连字符版本号转点号，旧版版本前置需翻转', () => {
    assert.equal(formatModelDisplayName('anthropic/claude-opus-4.8'), 'Opus 4.8');
    assert.equal(formatModelDisplayName('anthropic/claude-haiku-4-5'), 'Haiku 4.5');
    assert.equal(formatModelDisplayName('anthropic/claude-3-7-sonnet'), 'Sonnet 3.7');
    assert.equal(formatModelDisplayName('anthropic/claude-sonnet-4-6'), 'Sonnet 4.6');
  });

  await t.test('4. 厂商品牌大小写被修正', () => {
    assert.equal(parseModelDisplay('z-ai/glm-5.3').name, 'GLM 5.3');
    assert.equal(parseModelDisplay('minimax/minimax-m3').name, 'MiniMax M3');
    assert.equal(parseModelDisplay('xiaomi/mimo-v2.6-pro').name, 'MiMo V2.6 Pro');
    assert.equal(parseModelDisplay('deepseek/deepseek-v4.1-flash').name, 'DeepSeek V4.1 Flash');
    assert.equal(parseModelDisplay('moonshotai/kimi-k3').name, 'Kimi K3');
  });

  await t.test('5. 参数量写法修正为 B 大写', () => {
    assert.equal(parseModelDisplay('nvidia/nemotron-3-super-120b-a12b').name, 'Nemotron 3 Super 120B A12B');
  });

  await t.test('6. gpt 家族保留 GPT- 前缀，中段连字符转空格', () => {
    assert.equal(parseModelDisplay('openai/gpt-5.5').name, 'GPT-5.5');
    assert.equal(parseModelDisplay('openai/gpt-6-astra-pro').name, 'GPT-6 Astra Pro');
  });

  await t.test('7. 路由后缀也保留在名字里', () => {
    assert.equal(parseModelDisplay('deepseek/deepseek-v4.1-flash:US').name, 'DeepSeek V4.1 Flash US');
    assert.equal(parseModelDisplay('upstage/solar-mini4:free').name, 'Solar Mini4 Free');
  });

  await t.test('8. 上下文窗口后缀保留在名字里', () => {
    assert.equal(parseModelDisplay('anthropic/claude-sonnet-4.5[1m]').name, 'Sonnet 4.5 1M');
  });

  await t.test('9. GGUF 量化保留在名字里，且两种书写顺序等价', () => {
    const a = parseModelDisplay('qwen/qwen3-32b-flash-Q4_K_M');
    const b = parseModelDisplay('qwen/qwen3-32b-Q4_K_XL-flash');
    assert.equal(a.quant, 'Q4_K_M');
    assert.equal(b.quant, 'Q4_K_XL');
    assert.ok(a.name.includes('Q4_K_M'), '量化档位必须出现在名字里');
    assert.ok(b.name.includes('Q4_K_XL'));
    assert.ok(a.name.includes('Flash') && b.name.includes('Flash'));
  });

  await t.test('10. 日期快照：8 位剥出后仍拼回名字，4 位视为版本号保留', () => {
    const dated = parseModelDisplay('anthropic/claude-sonnet-5-20251101');
    assert.equal(dated.date, '20251101');
    assert.ok(dated.name.includes('20251101'), '日期快照必须留在名字里');

    // 4 位数字与版本号无法区分，原样作为主体保留
    assert.equal(parseModelDisplay('grok-4.20-0309-reasoning').name, 'Grok 4.20 0309 Reasoning');
    assert.equal(parseModelDisplay('grok-4.20-0309-non-reasoning').name, 'Grok 4.20 0309 Non-reasoning');
  });

  await t.test('11. 同一族不同变体必须可区分（防名字坍缩）', () => {
    const pairs = [
      ['anthropic/claude-opus-4.8', 'anthropic/claude-opus-4.8-fast'],
      ['grok-4.20-0309-reasoning', 'grok-4.20-0309-non-reasoning'],
      ['deepseek/deepseek-v4-pro-0813', 'deepseek/deepseek-v4.1-flash-1017'],
      ['google/gemini-3.8-flash', 'google/gemini-3.7-flash'],
    ];
    for (const [a, b] of pairs) {
      assert.notEqual(formatModelDisplayName(a), formatModelDisplayName(b), `${a} 与 ${b} 不得同名`);
    }
  });

  await t.test('12. 空串与异常输入优雅降级，绝不抛异常', () => {
    assert.equal(formatModelDisplayName(''), '');
    assert.deepEqual(parseModelDisplay(undefined).name, '');
    assert.equal(parseModelDisplay(null).name, '');
    assert.equal(modelVariantTag(''), '');
  });

  await t.test('13. 无法识别的 ID 回退为原文可读串，不得为空', () => {
    const parts = parseModelDisplay('some-weird-model-x');
    assert.equal(parts.name, 'Some Weird Model X');
  });

  await t.test('14. stripProviderPrefix 只取末段（代理分组名不是模型名）', () => {
    assert.equal(stripProviderPrefix('group/deepseek-v4.1-flash'), 'deepseek-v4.1-flash');
    assert.equal(stripProviderPrefix('grok-4.6'), 'grok-4.6');
    assert.equal(stripProviderPrefix('  a/b/c  '), 'c');
  });

  await t.test('15. 名字中不含连续空格', () => {
    for (const id of ['gemini-3.8-flash', 'grok-4.20-0309-reasoning', 'nvidia/nemotron-3-super-120b-a12b']) {
      assert.ok(!parseModelDisplay(id).name.includes('  '), `${id} 不得含连续空格`);
    }
  });
});

test('modelNaming - 厂商判定', async (t) => {
  await t.test('1. 已知前缀直取展示名', () => {
    assert.equal(resolveModelVendor('anthropic/claude-opus-4.8'), 'Anthropic');
    assert.equal(resolveModelVendor('x-ai/grok-4.7'), 'xAI');
    assert.equal(resolveModelVendor('z-ai/glm-5.3'), 'Z.AI');
  });

  await t.test('2. 无前缀的自定义 provider 按主体名推断厂商', () => {
    assert.equal(resolveModelVendor('gemini-3.8-flash'), 'Google');
    assert.equal(resolveModelVendor('claude-sonnet-4-6'), 'Anthropic');
    assert.equal(resolveModelVendor('gpt-6-luna'), 'OpenAI');
  });

  await t.test('3. group 这类路由分组名不得冒充厂商', () => {
    assert.equal(resolveModelVendor('group/deepseek-v4.1-flash', 'cpa'), 'DeepSeek');
    assert.equal(resolveModelVendor('group/unknown-model', 'cpa'), 'cpa');
  });

  await t.test('4. 无法判定时回退 provider 名，不返回 undefined', () => {
    assert.equal(resolveModelVendor('zzz-unknown', 'my-provider'), 'my-provider');
    assert.equal(resolveModelVendor('', ''), '');
  });
});

test('modelCatalog - 网关真实响应归一化', async (t) => {
  const fixture = loadGatewayFixture();

  await t.test('1. 真实 fixture 必须产出非空扁平条目', () => {
    const view = buildModelCatalogView(fixture.result);
    assert.equal(view.ok, true);
    assert.ok(view.entries.length > 0);
    for (const entry of view.entries) {
      assert.ok(entry.id.length > 0);
      assert.ok(entry.providerSlug.length > 0);
      assert.ok(entry.displayName.length > 0, `条目 ${entry.id} 的显示名不得为空`);
    }
  });

  await t.test('2. 当前模型与 provider 必须透传网关报告值', () => {
    const view = buildModelCatalogView(fixture.result);
    assert.equal(view.currentModel, fixture.result.model);
    assert.equal(view.currentProvider, fixture.result.provider);
    assert.equal(readCurrentSelection(fixture.result).model, fixture.result.model);
  });

  await t.test('3. models 必须覆盖 entries 全部 id（允许额外含被截断的根层当前模型）', () => {
    const view = buildModelCatalogView(fixture.result);
    const entryIds = Array.from(new Set(view.entries.map((e) => e.id)));
    for (const id of entryIds) {
      assert.ok(view.models.includes(id), `models 必须覆盖 entries 的 ${id}`);
    }
    const extras = view.models.filter((id) => !entryIds.includes(id));
    assert.deepEqual(extras, [fixture.result.model], 'models 额外项只能是根层当前模型');
  });

  await t.test('4. 探针占位符 <more:N> 必须被丢弃', () => {
    const view = buildModelCatalogView(fixture.result);
    for (const entry of view.entries) {
      assert.ok(!entry.id.startsWith('<'), `占位符 ${entry.id} 不得成为可选模型`);
      assert.ok(!entry.displayName.includes('more:'));
    }
    for (const id of view.models) {
      assert.ok(!id.startsWith('<'));
    }
  });

  await t.test('5. pricing / capabilities 必须按模型 ID 正确挂载', () => {
    const view = buildModelCatalogView(fixture.result);
    const opus = view.entries.find((e) => e.id === 'anthropic/claude-opus-5.5');
    assert.ok(opus);
    assert.equal(opus.providerSlug, 'nous');
    assert.equal(opus.pricing?.input, '$4.00');
    assert.equal(opus.capabilities?.reasoning, true);
    assert.equal(opus.vendor, 'Anthropic');
    // 展示名与图标 slug 必须同源派生：只断 vendor 会让「图标查表键」静默丢失
    assert.equal(opus.vendorId, 'anthropic');
  });

  await t.test('6. 跨 provider 同名模型各自保留', () => {
    const entries = normalizeModelCatalog({
      providers: [
        { slug: 'cpa', name: 'cpa', models: ['gemini-3.8-flash'] },
        { slug: 'nous', name: 'Nous Portal', models: ['gemini-3.8-flash'] },
      ],
    });
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map((e) => e.providerSlug), ['cpa', 'nous']);
  });

  await t.test('6b. 同一 provider 内不同 ID 派生出同名时必须消歧（真实 fixture 回归）', () => {
    const view = buildModelCatalogView(fixture.result);
    const byProvider = new Map();
    for (const entry of view.entries) {
      const list = byProvider.get(entry.providerSlug) ?? [];
      list.push(entry);
      byProvider.set(entry.providerSlug, list);
    }
    for (const [slug, list] of byProvider) {
      const names = list.map((e) => e.displayName);
      assert.equal(
        new Set(names).size,
        names.length,
        `provider ${slug} 内出现同名条目：${names.filter((n, i) => names.indexOf(n) !== i).join(', ')}`,
      );
    }

    const cpaFlash = view.entries.filter((e) => e.providerSlug === 'cpa' && e.id.includes('deepseek-v4.1-flash'));
    if (cpaFlash.length > 1) {
      assert.notEqual(cpaFlash[0].displayName, cpaFlash[1].displayName);
      assert.ok(cpaFlash.some((e) => e.displayName.includes('group')));
    }
  });

  await t.test('6c. 消歧只改 name/displayName，绝不改写 id', () => {
    const entries = normalizeModelCatalog({
      providers: [{ slug: 'p', name: 'P', models: ['group/x-model', 'x-model'] }],
    });
    assert.deepEqual(entries.map((e) => e.id), ['group/x-model', 'x-model']);
    assert.notEqual(entries[0].displayName, entries[1].displayName);
  });

  await t.test('7. 分组保持网关原始 provider 顺序', () => {
    const view = buildModelCatalogView(fixture.result);
    const groups = groupCatalogByProvider(view.entries);
    const expected = fixture.result.providers.map((p) => p.slug);
    assert.deepEqual(groups.map((g) => g.slug), expected);
  });

  await t.test('8. 全部真实模型 ID 都能派生出非空且含完整词的名字', () => {
    const view = buildModelCatalogView(fixture.result);
    const allIds = new Set();
    for (const provider of fixture.result.providers) {
      for (const id of Object.keys(provider.pricing || {})) allIds.add(id);
      for (const id of provider.models || []) allIds.add(id);
    }
    assert.ok(allIds.size > 50);
    for (const id of allIds) {
      if (id.startsWith('<')) continue;
      const parts = parseModelDisplay(id);
      assert.ok(parts.name.length > 0, `${id} 必须派生出非空名称`);
      assert.ok(!parts.name.includes('  '), `${id} 派生名不得含连续空格`);
      // 后缀词必须在名字里出现，不得被扣掉
      if (parts.variant) assert.ok(parts.name.includes(parts.variant), `${id} 的名字必须包含变体 ${parts.variant}`);
      if (parts.quant) assert.ok(parts.name.includes(parts.quant), `${id} 的名字必须包含量化 ${parts.quant}`);
    }
  });
});

test('modelCatalogFingerprint - 指纹必须覆盖全部渲染字段', async (t) => {
  const base = {
    id: 'anthropic/claude-opus-4.8',
    providerSlug: 'nous',
    providerName: 'Nous Portal',
    name: 'Opus 4.8',
    variant: '',
    quant: '',
    context: '',
    route: '',
    date: '',
    vendor: 'Anthropic',
    vendorId: 'anthropic',
    displayName: 'Opus 4.8',
    featured: false,
    unavailable: false,
  };

  const fp = (entry) => modelCatalogFingerprint([entry]);

  await t.test('1. 空目录返回空串', () => {
    assert.equal(modelCatalogFingerprint([]), '');
    assert.equal(modelCatalogFingerprint(null), '');
  });

  await t.test('2. 同一输入稳定同输出', () => {
    assert.equal(fp(base), fp({ ...base }));
  });

  await t.test('3. unavailable 翻转必须改变指纹', () => {
    assert.notEqual(fp(base), fp({ ...base, unavailable: true }));
  });

  await t.test('4. featured / quant / context / route / date 变化必须改变指纹', () => {
    const reference = fp(base);
    assert.notEqual(reference, fp({ ...base, featured: true }));
    assert.notEqual(reference, fp({ ...base, quant: 'Q4_K_M' }));
    assert.notEqual(reference, fp({ ...base, context: '1M' }));
    assert.notEqual(reference, fp({ ...base, route: 'free' }));
    assert.notEqual(reference, fp({ ...base, date: '20251101' }));
  });

  await t.test('5. 价格 / 能力 / provider 告警变化必须改变指纹', () => {
    const reference = fp(base);
    assert.notEqual(reference, fp({ ...base, pricing: { input: '$1.00', output: '$2.00', free: false } }));
    assert.notEqual(reference, fp({ ...base, capabilities: { fast: false, reasoning: true } }));
    assert.notEqual(reference, fp({ ...base, providerWarning: '需要升级' }));
  });

  await t.test('6. providerSlug / providerName / variant / contextLength / supportsVision / id / vendor 必须参与指纹', () => {
    const reference = fp(base);
    assert.notEqual(reference, fp({ ...base, providerSlug: 'cpa' }));
    assert.notEqual(reference, fp({ ...base, providerName: 'cpa' }));
    assert.notEqual(reference, fp({ ...base, variant: 'Fast' }));
    assert.notEqual(reference, fp({ ...base, contextLength: 200000 }));
    assert.notEqual(reference, fp({ ...base, supportsVision: true }));
    assert.notEqual(reference, fp({ ...base, id: 'anthropic/claude-opus-5' }));
    assert.notEqual(reference, fp({ ...base, vendor: 'OpenAI' }));
  });

  await t.test('7. vendorId 变化必须改变指纹（图标会换，不重绘就会显示旧品牌）', () => {
    const reference = fp(base);
    assert.notEqual(reference, fp({ ...base, vendorId: 'openai' }));
    assert.notEqual(reference, fp({ ...base, vendorId: '' }));
  });

  await t.test('7. 显示名变化必须改变指纹（网关改名场景）', () => {
    assert.notEqual(fp(base), fp({ ...base, displayName: 'Opus 4.8 Renamed' }));
  });

  await t.test('8. 新增/删除条目必须改变指纹', () => {
    const other = { ...base, id: 'anthropic/claude-sonnet-5', displayName: 'Sonnet 5' };
    assert.notEqual(fp(base), modelCatalogFingerprint([base, other]));
  });
});

test('modelCatalog - 边界与失败语义', async (t) => {
  await t.test('1. 空/非法 payload 返回 ok=false 且带 error，不得虚构模型', () => {
    for (const payload of [null, undefined, {}, { providers: [] }, 42, 'x']) {
      const view = buildModelCatalogView(payload);
      assert.equal(view.ok, false);
      assert.deepEqual(view.entries, []);
      assert.deepEqual(view.models, []);
      assert.ok(typeof view.error === 'string' && view.error.length > 0);
    }
  });

  await t.test('2. 显式错误文案优先于默认文案', () => {
    assert.equal(buildModelCatalogView(null, { error: 'REST 404' }).error, 'REST 404');
  });

  await t.test('3. provider 缺少 slug 时整行跳过', () => {
    const entries = normalizeModelCatalog({
      providers: [{ name: 'No Slug', models: ['a-model'] }, { slug: 'ok', models: ['b-model'] }],
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].providerSlug, 'ok');
  });

  await t.test('4. models 混入对象形状时按 id/name 弹性取值', () => {
    const entries = normalizeModelCatalog({
      providers: [{ slug: 'p', name: 'P', models: [{ id: 'obj-id', name: 'Obj' }, { name: 'name-only' }, '', null] }],
    });
    assert.deepEqual(entries.map((e) => e.id), ['obj-id', 'name-only']);
  });

  await t.test('5. 大小写不同的重复 ID 视为同一模型', () => {
    const entries = normalizeModelCatalog({ providers: [{ slug: 'p', models: ['Model-A', 'model-a'] }] });
    assert.equal(entries.length, 1);
  });

  await t.test('5b. models 列表的跨 provider 大小写去重', () => {
    const view = buildModelCatalogView({
      providers: [
        { slug: 'a', name: 'A', models: ['Gemini-X'], authenticated: true },
        { slug: 'b', name: 'B', models: ['gemini-x'], authenticated: true },
      ],
      model: '',
      provider: 'a',
    });
    assert.equal(view.entries.length, 2);
    assert.deepEqual(view.models, ['Gemini-X']);
  });

  await t.test('6. findCatalogEntry 三级匹配', () => {
    const entries = normalizeModelCatalog({
      providers: [
        { slug: 'cpa', name: 'cpa', models: ['gemini-3.8-flash'] },
        { slug: 'nous', name: 'Nous Portal', models: ['gemini-3.8-flash'] },
      ],
    });
    assert.equal(findCatalogEntry(entries, 'gemini-3.8-flash', 'nous')?.providerSlug, 'nous');
    assert.equal(findCatalogEntry(entries, 'gemini-3.8-flash', 'auto')?.providerSlug, 'cpa');
    assert.equal(findCatalogEntry(entries, 'nope'), undefined);
    assert.equal(findCatalogEntry(entries, ''), undefined);
  });

  await t.test('7. modelLabelFromCatalog 命中用目录名，未命中回退派生名', () => {
    const entries = normalizeModelCatalog({
      providers: [{ slug: 'p', name: 'P', models: ['anthropic/claude-opus-4.8-fast'] }],
    });
    assert.equal(modelLabelFromCatalog(entries, 'anthropic/claude-opus-4.8-fast', 'p'), 'Opus 4.8 Fast');
    assert.equal(modelLabelFromCatalog(entries, 'anthropic/claude-sonnet-5', 'p'), 'Sonnet 5');
    assert.equal(modelLabelFromCatalog([], 'openai/gpt-6-luna'), 'GPT-6 Luna');
  });

  await t.test('8. warning / featured 落到条目上，unavailable 的模型被剔除', () => {
    const entries = normalizeModelCatalog({
      providers: [
        {
          slug: 'p',
          name: 'P',
          models: ['m1', 'm2', 'm3'],
          featured_models: ['m1'],
          unavailable_models: ['m2'],
          warning: 'paste KEY to activate',
        },
      ],
    });
    assert.equal(entries.find((e) => e.id === 'm1').featured, true);
    assert.equal(entries.find((e) => e.id === 'm2'), undefined, '被锁模型不得进入可选列表');
    assert.equal(entries.find((e) => e.id === 'm3').unavailable, false);
    assert.equal(entries[0].providerWarning, 'paste KEY to activate');
  });
});

test('normalizeModelCatalog - provider 可选性过滤', async (t) => {
  await t.test('1. authenticated:false 的 provider 整行丢弃', () => {
    const entries = normalizeModelCatalog({
      providers: [
        { slug: 'ok', name: 'OK', models: ['m1'], authenticated: true },
        { slug: 'dead', name: 'Dead', models: ['m2'], authenticated: false },
      ],
    });
    assert.deepEqual(entries.map((e) => e.id), ['m1']);
  });

  await t.test('2. authenticated:true 优先于任何历史负向标志', () => {
    const entries = normalizeModelCatalog({
      providers: [
        { slug: 'p', name: 'P', models: ['m1'], authenticated: true, configured: false, status: 'unconfigured' },
      ],
    });
    assert.equal(entries.length, 1);
  });

  await t.test('3. 缺省 authenticated 时才看历史负向标志', () => {
    const entries = normalizeModelCatalog({
      providers: [
        { slug: 'a', models: ['keep'] },
        { slug: 'b', models: ['drop'], configured: false },
        { slug: 'c', models: ['drop'], has_key: false },
        { slug: 'd', models: ['drop'], status: 'disabled' },
        { slug: 'e', models: ['drop'], models_hidden: true },
      ],
    });
    assert.deepEqual(entries.map((e) => e.id), ['keep']);
  });

  await t.test('4. 真实 fixture 的所有已认证 provider 都不得被误杀', () => {
    const fixture = loadGatewayFixture();
    const authedRows = fixture.result.providers.filter((p) => p.authenticated === true);
    assert.ok(authedRows.length > 0);
    const entries = normalizeModelCatalog(fixture.result);
    assert.ok(entries.length > 0);
    const slugs = new Set(entries.map((e) => e.providerSlug));
    for (const row of authedRows) {
      assert.ok(slugs.has(row.slug), `已认证 provider ${row.slug} 不得被误杀`);
    }
  });

  await t.test('5. 全部模型都被锁的 provider 必须整行隐藏（未订阅 = 一个都选不了）', () => {
    const entries = normalizeModelCatalog({
      providers: [
        {
          slug: 'nous',
          name: 'Nous Portal',
          models: ['anthropic/claude-opus-5.5', 'openai/gpt-6-astra'],
          unavailable_models: ['anthropic/claude-opus-5.5', 'openai/gpt-6-astra'],
          authenticated: true,
        },
        { slug: 'cpa', name: 'cpa', models: ['gemini-3.8-flash'], authenticated: true },
      ],
    });
    assert.deepEqual(entries.map((e) => e.providerSlug), ['cpa'], '全锁的 nous 行必须整行消失');
  });

  await t.test('6. 部分锁定的 provider 保留，但被锁模型必须从条目里剔除', () => {
    const entries = normalizeModelCatalog({
      providers: [
        {
          slug: 'nous',
          name: 'Nous Portal',
          models: ['paid-model', 'free-model'],
          unavailable_models: ['paid-model'],
          authenticated: true,
        },
      ],
    });
    assert.equal(entries.length, 1, '只保留可用模型，被锁的一条不得出现在列表里');
    assert.equal(entries[0].id, 'free-model');
    assert.equal(entries.some((e) => e.id === 'paid-model'), false);
  });

  await t.test('7. free_tier_pending（订阅等级未知）必须放行，不得剔模型也不得隐藏整行', () => {
    const entries = normalizeModelCatalog({
      providers: [
        {
          slug: 'nous',
          name: 'Nous Portal',
          models: ['a', 'b', 'c'],
          unavailable_models: ['a', 'b', 'c'],
          authenticated: true,
          free_tier_pending: true,
          warning: 'Checking Nous plan entitlement…',
        },
      ],
    });
    assert.equal(entries.length, 3, 'pending 期间的锁名单是占位，不能当成真实拒绝');
  });

  await t.test('8. pricing_pending 但 free_tier 已确认时，锁名单是真实拒绝，必须照常剔除', () => {
    const entries = normalizeModelCatalog({
      providers: [
        {
          slug: 'nous',
          name: 'Nous Portal',
          models: ['paid-a', 'paid-b'],
          unavailable_models: ['paid-a', 'paid-b'],
          authenticated: true,
          pricing_pending: true,
          free_tier: true,
        },
      ],
    });
    assert.deepEqual(entries, [], '免费层确认 + 全锁 = 真实拒绝，整行隐藏');
  });

  await t.test('9. 全锁 + authenticated:false 仍按"未认证"隐藏', () => {
    const entries = normalizeModelCatalog({
      providers: [
        { slug: 'dead', name: 'Dead', models: ['x'], unavailable_models: ['x'], authenticated: false },
      ],
    });
    assert.deepEqual(entries, []);
  });

  await t.test('10. unavailable 含 models 之外的 id 时，只剔除真实命中的模型', () => {
    const entries = normalizeModelCatalog({
      providers: [
        {
          slug: 'p',
          name: 'P',
          models: ['m1', 'm2'],
          unavailable_models: ['m1', 'ghost-model'],
          authenticated: true,
        },
      ],
    });
    assert.deepEqual(entries.map((e) => e.id), ['m2'], 'm2 仍可选，整行必须保留');
  });

  await t.test('11. 真实 nous 行：pending 撤销后必须整行隐藏', () => {
    const fixture = loadGatewayFixture();
    const nousRow = fixture.result.providers.find((p) => p.slug === 'nous');
    assert.ok(nousRow, 'fixture 必须含 nous 行');

    const resolved = { ...nousRow, free_tier_pending: false, unavailable_models: [...nousRow.models] };
    const entries = normalizeModelCatalog({
      providers: [resolved, { slug: 'ok', name: 'OK', models: ['m'], authenticated: true }],
    });
    assert.ok(!entries.some((e) => e.providerSlug === 'nous'), '订阅确认不可用时 nous 整行必须隐藏');
    assert.ok(entries.some((e) => e.providerSlug === 'ok'));
  });
});
