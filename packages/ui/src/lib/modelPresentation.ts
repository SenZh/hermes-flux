/**
 * 模型显示的统一解析层（输入舱模型选择器与设置中心共用）。
 *
 * 【设计意图 (Why)】
 *   同一个模型在输入舱、提供商面板、端点编辑表单里必须写成同一个名字、配同一个图形。
 *   显示名已经由 core 的 `parseModelDisplay` 统一推导，本文件只补两件渲染层的事：
 *   把 core 解析出的厂商映射成稳定的品牌标识，以及把这两者打包成可直接渲染的行模型。
 *   任何组件都不得再自己拼 `provider/name` 或自己猜厂商。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 直接渲染模型 ID（`group/deepseek-v4.1-flash`）等于把机器串丢给用户；
 *   2. 各组件各自维护一套厂商 emoji，同一模型在两处长得不一样；
 *   3. 设置页禁止 emoji 图标（设计系统要求 lucide 描边语言），所以品牌标识必须是
 *      与渲染方式无关的枚举，由各渲染面决定画 SVG 还是其它形态。
 *
 * 【约束与规则 (Rules)】
 *   1. 纯函数、零 DOM、零 React；
 *   2. 显示名一律来自 core，本文件不重新发明命名规则；
 *   3. 识别不出厂商时回退 `unknown`，绝不返回空串或抛错。
 */

import { parseModelDisplay } from '@hermes-flux/core';

/** 可识别的模型品牌。渲染层按它选择图形，不依赖具体厂商文案。 */
export type ModelBrand =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'deepseek'
  | 'xai'
  | 'qwen'
  | 'moonshot'
  | 'zai'
  | 'minimax'
  | 'meta'
  | 'mistral'
  | 'nvidia'
  | 'xiaomi'
  | 'tencent'
  | 'local'
  | 'unknown';

/** core `resolveModelVendor` 的展示名 → 品牌标识。键一律小写。 */
const VENDOR_BRANDS: Readonly<Record<string, ModelBrand>> = {
  anthropic: 'anthropic',
  openai: 'openai',
  google: 'google',
  deepseek: 'deepseek',
  xai: 'xai',
  qwen: 'qwen',
  moonshot: 'moonshot',
  'z.ai': 'zai',
  minimax: 'minimax',
  meta: 'meta',
  mistral: 'mistral',
  'mistral ai': 'mistral',
  nvidia: 'nvidia',
  xiaomi: 'xiaomi',
  tencent: 'tencent',
  local: 'local',
  'lm studio': 'local',
  ollama: 'local',
};

/** 只有厂商名不足以判定时，才用 provider 自身标识兜底（自定义端点常这样）。 */
const PROVIDER_HINTS: ReadonlyArray<readonly [RegExp, ModelBrand]> = [
  [/anthropic|claude/i, 'anthropic'],
  [/openai|chatgpt|codex/i, 'openai'],
  [/google|gemini/i, 'google'],
  [/deepseek/i, 'deepseek'],
  [/xai|grok/i, 'xai'],
  [/qwen/i, 'qwen'],
  [/moonshot|kimi/i, 'moonshot'],
  [/z[-.]?ai|zhipu|glm/i, 'zai'],
  [/minimax/i, 'minimax'],
  [/nvidia|nemotron/i, 'nvidia'],
  [/mistral/i, 'mistral'],
  [/local|ollama|llama\.cpp|lmstudio/i, 'local'],
  [/llama|meta/i, 'meta'],
];

export function modelBrandFromVendor(vendor: string): ModelBrand {
  return VENDOR_BRANDS[vendor.trim().toLowerCase()] ?? 'unknown';
}

/** 从 provider 的 id / 展示名推断品牌，供没有具体模型时的来源图标使用。 */
export function modelBrandFromProvider(providerId: string, providerName = ''): ModelBrand {
  const text = `${providerId} ${providerName}`.trim();
  for (const [pattern, brand] of PROVIDER_HINTS) {
    if (pattern.test(text)) return brand;
  }
  return 'unknown';
}

/** 一条模型在渲染层需要的全部字段。`id` 只用于键与写回，不得直接展示。 */
export interface ModelPresentation {
  id: string;
  name: string;
  variant: string;
  quant: string;
  context: string;
  route: string;
  date: string;
  vendor: string;
  brand: ModelBrand;
}

/**
 * 解析一条模型。
 * 【规则】`name` 是完整可读名（含全部尾部标签）；品牌优先用模型自身的厂商，
 *   解析不出时回落到 provider 标识。
 */
export function presentModel(modelId: string, providerName = ''): ModelPresentation {
  const parts = parseModelDisplay(modelId, providerName);
  const vendorBrand = modelBrandFromVendor(parts.vendor);
  return {
    id: modelId,
    name: parts.name,
    variant: parts.variant,
    quant: parts.quant,
    context: parts.context,
    route: parts.route,
    date: parts.date,
    vendor: parts.vendor,
    brand: vendorBrand === 'unknown' ? modelBrandFromProvider('', providerName) : vendorBrand,
  };
}
