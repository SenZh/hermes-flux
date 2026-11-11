/**
 * 厂商身份派生单测 (modelNaming vendor identity)
 *
 * 【覆盖目标】
 *   `vendorId` 是图标查表的唯一键，一旦判错就会出现「Gemini 顶着 OpenAI 的 logo」
 *   这种比没图标更糟的误导。因此这里逐条钉死四类形态：
 *   显式厂商前缀、无前缀的模型主体、代理分组前缀、以及已知厂商但上游没有图标。
 *
 * 【为什么必须断言空串而不是回退】
 *   `cpa` / `nous` 是接入入口而非厂商。把它们当厂商去查图标，命中与否都是错的：
 *   命中就是错误归属，不命中就是随机降级。唯一正确的答案是「不知道就说不知道」。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseModelDisplay,
  resolveModelVendor,
  resolveModelVendorId,
  resolveProviderVendorId,
} from '../../dist/models/modelNaming.js';

test('resolveModelVendorId - 显式厂商前缀', async (t) => {
  await t.test('标准前缀直接命中', () => {
    assert.equal(resolveModelVendorId('anthropic/claude-opus-5'), 'anthropic');
    assert.equal(resolveModelVendorId('openai/gpt-6-astra-pro'), 'openai');
    assert.equal(resolveModelVendorId('deepseek/deepseek-v4.1-flash'), 'deepseek');
    assert.equal(resolveModelVendorId('qwen/qwen3-max'), 'qwen');
  });

  await t.test('同一厂商的多种别名收敛到同一 slug', () => {
    assert.equal(resolveModelVendorId('z-ai/glm-5.2'), 'zhipu');
    assert.equal(resolveModelVendorId('zai/glm-5.2'), 'zhipu');
    assert.equal(resolveModelVendorId('x-ai/grok-4.20'), 'xai');
    assert.equal(resolveModelVendorId('minimax/minimax-m3'), 'minimax');
  });

  await t.test('代理型复合前缀按段回退到厂商', () => {
    assert.equal(resolveModelVendorId('xai-oauth/grok-4.20-reasoning'), 'xai');
    assert.equal(resolveModelVendorId('anthropic-oauth/claude-opus-5'), 'anthropic');
  });
});

test('resolveModelVendorId - 无厂商前缀时按模型主体推断', async (t) => {
  await t.test('自定义 provider 裸模型 ID', () => {
    assert.equal(resolveModelVendorId('gemini-3.8-flash'), 'google');
    assert.equal(resolveModelVendorId('claude-opus-4.8-fast'), 'anthropic');
    assert.equal(resolveModelVendorId('gpt-6-astra-pro-fast'), 'openai');
    assert.equal(resolveModelVendorId('kimi-k2'), 'moonshot');
    assert.equal(resolveModelVendorId('mimo-v2'), 'xiaomimimo');
    assert.equal(resolveModelVendorId('hy2-turbo'), 'tencent');
  });

  await t.test('`group/` 与 `custom/` 都是路由分组名，不得当厂商', () => {
    assert.equal(resolveModelVendorId('group/deepseek-v4.1-flash'), 'deepseek');
    assert.equal(resolveModelVendorId('group/grok-4.20'), 'xai');
    // custom 前缀同样只是"自定义接入"标记，厂商仍由主体名决定
    assert.equal(resolveModelVendorId('custom/gemini-3.8-flash'), 'google');
    assert.equal(resolveModelVendor('custom/mystery-model-1', 'cpa'), 'cpa');
  });
});

test('resolveModelVendorId - 判不出时返回空串（不臆造）', async (t) => {
  await t.test('未知前缀不回退 provider', () => {
    assert.equal(resolveModelVendorId('cpa/mystery-model-7', 'cpa'), '');
    assert.equal(resolveModelVendorId('agent/some-internal-model', 'Nous Portal'), '');
    // 关键：provider 名恰好是厂商名也不得回退——厂商身份只由模型 ID 决定
    assert.equal(resolveModelVendorId('agent/unknown-1', 'anthropic'), '');
  });

  await t.test('已知厂商但上游无官方图标时也返回空串', () => {
    assert.equal(resolveModelVendorId('inclusionai/ling-2'), '');
    assert.equal(resolveModelVendorId('ornith-1.0'), '');
    assert.equal(resolveModelVendorId('llamacpp/qwen3-8b-Q4_K_M'), '');
  });

  await t.test('空输入不抛异常', () => {
    assert.equal(resolveModelVendorId(''), '');
    assert.equal(resolveModelVendorId('   '), '');
  });
});

test('resolveModelVendor - 展示名行为保持向后兼容', async (t) => {
  await t.test('前缀命中仍返回品牌大小写写法', () => {
    assert.equal(resolveModelVendor('zai/glm-5.2'), 'Z.AI');
    assert.equal(resolveModelVendor('mistralai/mistral-large'), 'Mistral AI');
  });

  await t.test('判不出时仍回退 provider 名或原始前缀（历史行为）', () => {
    assert.equal(resolveModelVendor('group/deepseek-v4.1-flash', 'cpa'), 'DeepSeek');
    assert.equal(resolveModelVendor('agent/unknown-1', 'Nous Portal'), 'agent');
    assert.equal(resolveModelVendor('gemini-3.8-flash', 'cpa'), 'Google');
  });
});

test('resolveProviderVendorId - provider 维度判定', async (t) => {
  await t.test('slug 命中厂商', () => {
    assert.equal(resolveProviderVendorId('xai-oauth', 'xAI Grok OAuth'), 'xai');
    assert.equal(resolveProviderVendorId('anthropic'), 'anthropic');
    assert.equal(resolveProviderVendorId('openrouter', 'OpenRouter'), 'openrouter');
  });

  await t.test('展示名里的厂商词也可命中', () => {
    assert.equal(resolveProviderVendorId('proxy-a', 'DeepSeek Direct'), 'deepseek');
  });

  await t.test('接入入口不是厂商，返回空串', () => {
    assert.equal(resolveProviderVendorId('cpa', 'cpa'), '');
    assert.equal(resolveProviderVendorId('nous', 'Nous Portal'), '');
    assert.equal(resolveProviderVendorId('', ''), '');
  });

  await t.test('只认完整段，禁止子串模糊匹配', () => {
    // `nousresearch` 里含 `nous`，但不代表它是 Nous 的厂商图标
    assert.equal(resolveProviderVendorId('nousresearch', 'Nous Research'), '');
  });

  await t.test('兼容/聚合入口整条跳过，避免把转发方当成厂商', () => {
    // `openai-compatible` 实际可能跑着 DeepSeek，显示 OpenAI 的标识就是错误归属。
    // 转发词必须逐个钉死：少一个词就多一类错误归属，且不会有任何报错。
    for (const word of ['compatible', 'proxy', 'aggregator', 'relay', 'router', 'gateway', 'mirror']) {
      assert.equal(
        resolveProviderVendorId(`deepseek-${word}`, `DeepSeek ${word}`),
        '',
        `转发词 ${word} 未生效`,
      );
    }
    // 不含转发语义的复合 slug 仍然命中（厂商 + 认证方式）
    assert.equal(resolveProviderVendorId('xai-oauth', 'xAI Grok OAuth'), 'xai');
    // `openrouter` 是真实接入商，段里没有独立的 router 段，必须照常命中
    assert.equal(resolveProviderVendorId('openrouter', 'OpenRouter'), 'openrouter');
  });
});

test('parseModelDisplay - vendorId 与 vendor 同源派生', async (t) => {
  await t.test('两条字段必须指向同一判定结果', () => {
    const parts = parseModelDisplay('zai/glm-5.2');
    assert.equal(parts.vendor, 'Z.AI');
    assert.equal(parts.vendorId, 'zhipu');
  });

  await t.test('空 ID 时两者都不臆造', () => {
    const parts = parseModelDisplay('', 'Nous Portal');
    assert.equal(parts.vendor, 'Nous Portal');
    assert.equal(parts.vendorId, '');
  });

  await t.test('展示名不得因新增 vendorId 而改变', () => {
    assert.equal(parseModelDisplay('anthropic/claude-opus-4.8-fast').name, 'Opus 4.8 Fast');
    assert.equal(parseModelDisplay('group/deepseek-v4.1-flash').name, 'DeepSeek V4.1 Flash');
  });
});
