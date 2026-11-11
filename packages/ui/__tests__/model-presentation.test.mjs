/**
 * 模型展示解析测试。
 *
 * 【为什么需要】`presentModel` 是输入舱、查看模型弹框与端点编辑下拉共用的唯一显示源。
 *   它一旦把品牌映射或名称透传改错，三个界面会一起漂移；而之前的 UI 测试只断言"有 <svg>"，
 *   把品牌映射改成恒返回 unknown 仍然全绿，属于变异存活。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  modelBrandFromProvider,
  modelBrandFromVendor,
  presentModel,
} from '../dist/lib/modelPresentation.js';

const BRAND_CASES = [
  ['anthropic/claude-opus-4.8-fast', 'anthropic'],
  ['openai/gpt-6-astra-pro', 'openai'],
  ['google/gemini-3.8-flash', 'google'],
  ['deepseek/deepseek-v4.1-flash', 'deepseek'],
  ['xai/grok-4', 'xai'],
  ['qwen/qwen3.8-flash', 'qwen'],
  ['moonshotai/kimi-k3', 'moonshot'],
  ['z-ai/glm-5.3', 'zai'],
  ['minimax/minimax-m3', 'minimax'],
  ['meta/llama-4', 'meta'],
  ['mistral/mistral-large', 'mistral'],
  ['nvidia/nemotron-3', 'nvidia'],
  ['xiaomi/mimo-v2.6-pro', 'xiaomi'],
  ['llamacpp/qwen3-32b', 'local'],
  ['foo/bar', 'unknown'],
];

test('modelBrandFromVendor：厂商展示名必须逐条映射到稳定品牌', () => {
  for (const [modelId, expected] of BRAND_CASES) {
    assert.equal(presentModel(modelId).brand, expected, `${modelId} 的品牌应为 ${expected}`);
  }
});

test('modelBrandFromVendor：非同名映射与大小写不得漂移', () => {
  assert.equal(modelBrandFromVendor('Z.AI'), 'zai');
  assert.equal(modelBrandFromVendor('LM Studio'), 'local');
  assert.equal(modelBrandFromVendor('Ollama'), 'local');
  assert.equal(modelBrandFromVendor('  Anthropic  '), 'anthropic');
  assert.equal(modelBrandFromVendor('Fröbel'), 'unknown');
});

test('modelBrandFromProvider：模型自身判不出厂商时按 provider 标识兜底', () => {
  assert.equal(modelBrandFromProvider('xai-oauth', 'xAI Grok OAuth'), 'xai');
  assert.equal(modelBrandFromProvider('z-ai'), 'zai');
  assert.equal(modelBrandFromProvider('local-llama'), 'local');
  assert.equal(modelBrandFromProvider('nous', 'Nous Portal'), 'unknown');
  assert.equal(modelBrandFromProvider('', ''), 'unknown');
});

test('presentModel：名称与标签必须原样透传 core 的解析结果', () => {
  const view = presentModel('qwen/qwen3-32b-Q4_K_M', 'Qwen');
  assert.equal(view.name, 'Qwen3 32B Q4_K_M', '完整可读名不得丢尾部标签');
  assert.equal(view.variant, '');
  assert.equal(view.quant, 'Q4_K_M');
  assert.equal(view.brand, 'qwen');

  const fast = presentModel('anthropic/claude-opus-4.8-fast', 'Anthropic');
  assert.equal(fast.name, 'Opus 4.8 Fast');
  assert.equal(fast.variant, 'Fast');
  assert.equal(fast.brand, 'anthropic');
});

test('presentModel：模型 ID 无法解析时不返回空串，也不抛错', () => {
  assert.deepEqual(presentModel('').name, '');
  assert.equal(presentModel('').brand, 'unknown');
  assert.equal(presentModel('   ').name, '');
  assert.equal(presentModel(undefined).name, '', '缺 ID 时按空前缀处理，绝不抛错');
});
