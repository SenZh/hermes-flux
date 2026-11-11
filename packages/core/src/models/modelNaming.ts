/**
 * 模型 ID 到人类可读名称的纯函数派生层 (packages/core/src/models/modelNaming.ts)
 *
 * 【设计意图 (Why)】
 *   网关 `model.options` 的 `providers[].models` 是**纯字符串数组**，元素只有原始 ID
 *   （`anthropic/claude-opus-5.5`、`openai/gpt-6-astra-pro-fast`、`deepseek/deepseek-v4.1-flash:free`）。
 *   模型级没有 `label` / `display_name` / `title` / 厂商名 / 上下文窗口——这些字段只存在于
 *   provider 层（`name: "Nous Portal"`）或独立的 `/api/model/info`（且只覆盖"当前已配置的那一个"）。
 *   因此可读名称必须在客户端由 ID 派生，这是唯一能 100% 覆盖的路径：
 *   models.dev 名称库只认内置厂商，自定义 OpenAI 兼容代理（如当前 `cpa`）在库里根本查不到。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. "直接把 ID 塞进按钮"：`InputDock` 曾把 `props.selectedModel` 原样渲染成输入舱标签，
 *      用户看到的是 `group/deepseek-v4.1-flash` 这种机器串。
 *   2. "靠后端加字段解决"：网关内部虽有 models.dev 的 `ModelInfo.name`，但**刻意不塞进 models[]**；
 *      且自定义 provider 无名称可查，即使上游加字段也大面积为空。
 *   3. **"把后缀从名字里删掉、只留徽标"**：曾把 `flash` / `fast` / 日期 / 量化从 `name` 剥离，
 *      只放到独立字段。结果 `gemini-3.8-flash` 显示成 `Gemini 3.8`——用户认不出这是哪个模型；
 *      徽标一旦被窄容器裁掉（320px 选择器），名字就彻底失真。**名字必须是完整的，一个词都不能少。**
 *   4. "首字母大写一把梭"：`glm-5.2` 会变成 `Glm 5.2`、`minimax-m3` 变成 `Minimax M3`，
 *      厂商自己的大小写被覆盖，视觉上像另一个产品。
 *   5. "4 位数字当日期"：`grok-4.20-0309-reasoning` 的 `0309` 被当成 3 月 9 日，与
 *      `-non-reasoning` 变体坍缩到同一个名字。
 *
 * 【约束与规则 (Rules)】
 *   - 纯函数，零 DOM / 零网络 / 零宿主依赖，可在 core / ui / desktop / mobile / web 全端同构复用；
 *   - **`name` 是完整可读名**：ID 里的每一个词都必须出现在 `name` 里，包括变体、日期快照、
 *     量化档位、上下文窗口、路由后缀。徽标只是视觉强调，不是信息载体，任何字段都不得从名字里扣掉；
 *   - 派生**只影响显示**，绝不改写 `id`：`id` 是 `config.set` / `session.create` 的唯一权威载荷；
 *   - 唯一允许剥离的是**厂商/路由前缀**（`anthropic/`、`group/`），因为那是 provider 归属维度，
 *     分组标题与 `vendor` 字段已经表达；
 *   - 任何未知形态的 ID 必须优雅降级为"原样可读串"，绝不返回空串或抛异常。
 */

/** 一个模型 ID 的显示拆解结果。`id` 本身不在此结构中，调用方必须自行保留原值。 */
export interface ModelDisplayParts {
  /** 完整可读名，例如 `Gemini 3.8 Flash` / `Opus 4.8 Fast`；ID 里有的词一个不丢 */
  name: string;
  /** 变体标签，如 `Fast` / `Flash` / `Thinking` / `Preview` / `Latest`，无则为空串 */
  variant: string;
  /** 本地量化标签（GGUF），如 `Q4_K_M` / `Q8_0`，无则为空串 */
  quant: string;
  /** 上下文窗口标签，如 `1M`，来自 `[1m]` 路由后缀，无则为空串 */
  context: string;
  /** 路由区域/层级标签，来自 `:US` / `:free` 后缀，如 `US` / `free`，无则为空串 */
  route: string;
  /** 日期快照标签，如 `0731` / `20251101`，无则为空串 */
  date: string;
  /** 厂商展示名，如 `Anthropic` / `DeepSeek`；无法判定时回退为原始前缀或空串 */
  vendor: string;
  /**
   * 厂商图标 slug，如 `anthropic` / `zhipu` / `xiaomimimo`，与图标资产文件名一一对应。
   * 判不出厂商、或该厂商没有官方图标时为空串（由 UI 降级为首字母 badge）。
   */
  vendorId: string;
}

/**
 * 尾部变体后缀 → 标签文案。
 *
 * 【规则】只匹配**结尾**，且一旦命中即从主体剥离，避免 `flash` 出现在模型名中段时被误伤
 * （如 `gemini-3.7-flash` 的 flash 是变体，而 `deepseek-v4-flash-0731` 剥离后还剩日期快照）。
 * 顺序敏感：
 *   - `-fast` 必须先于其它规则判定，否则 `…-pro-fast` 会先被别的规则吃掉一半；
 *   - `-non-reasoning` 必须先于 `-reasoning`，否则 `grok-4.20-0309-non-reasoning`
 *     会被当成 Reasoning 变体，与 `-0309-reasoning` 名字完全撞车。
 */
const VARIANT_TAGS: ReadonlyArray<readonly [RegExp, string]> = [
  [/-fast$/i, 'Fast'],
  [/-ultraspeed$/i, 'Ultraspeed'],
  [/-non-reasoning$/i, 'Non-reasoning'],
  [/-thinking$/i, 'Thinking'],
  [/-reasoning$/i, 'Reasoning'],
  [/-preview$/i, 'Preview'],
  [/-latest$/i, 'Latest'],
  [/-flash$/i, 'Flash'],
];

/**
 * GGUF 量化后缀 → 标签。本地托管模型（llamacpp / ollama）的 ID 末端常带
 * `-Q4_K_M` / `-UD-Q8_0` / `-BF16`，属于"同模型的另一种物理权重"，
 * 必须显示为标签而非名字的一部分，但**仍要拼回名字**（不同量化是不同的可下载项）。
 */
const QUANT_SUFFIX = /-(?:UD-)?(Q\d(?:_[A-Z0-9]+)*|IQ\d(?:_[A-Z0-9]+)*|F16|BF16|FP16)$/i;

/**
 * 厂商大小写修正表。
 *
 * 【为什么需要】模型 ID 一律小写，但厂商品牌名不是：`glm` 官方写 `GLM`、`minimax` 写 `MiniMax`、
 * `mimo` 写 `MiMo`。首字母大写的通用规则会把这些全做错，所以必须逐词覆盖。
 * 【规则】只在整词边界生效，`Minimax` 不会污染包含该子串的更长的词。
 */
const VENDOR_CASING: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bDeepseek\b/g, 'DeepSeek'],
  [/\bGlm\b/g, 'GLM'],
  [/\bMinimax\b/g, 'MiniMax'],
  [/\bOpenai\b/g, 'OpenAI'],
  [/\bErnie\b/g, 'ERNIE'],
  [/\bMimo\b/g, 'MiMo'],
  [/\bBge\b/g, 'BGE'],
  [/\bVl\b/g, 'VL'],
  [/\bIt\b/g, 'IT'],
  [/\bFp8\b/g, 'FP8'],
  [/\bAi\b/g, 'AI'],
  [/\bXai\b/g, 'xAI'],
  [/\bZai\b/g, 'Z.AI'],
  [/\bHy\b/g, 'HY'],
  [/\bSolar\b/g, 'Solar'],
];

/** 参数量写法修正：厂商写 `8B` / `120B` / `A12B`，绝不写 `8b`。 */
const PARAMETER_COUNT = /\b(a?)(\d+(?:\.\d+)?)b\b/gi;

/**
 * 厂商身份：展示名 + 稳定标识。
 *
 * 【设计意图 (Why)】
 *   `label` 是给人看的（`Mistral AI` / `Z.AI`），`id` 是给图标查表用的稳定 slug
 *   （`mistral` / `zhipu`），必须与 `packages/ui/src/icons/lobe/` 里的文件名一一对应。
 *   两者放在同一条记录里，杜绝「展示名一张表、图标映射又一张表」的双份真值漂移。
 *
 * 【约束与规则 (Rules)】
 *   - `id` 一律小写、无空格，且必须能在 lobe 图标清单里查到；查不到就留空串，
 *     由 UI 降级为首字母 badge，绝不臆造一个不存在的 slug。
 */
interface VendorIdentity {
  /** 人类可读厂商名 */
  label: string;
  /** 图标清单 slug；空串表示该厂商暂无官方图标 */
  id: string;
}

/** 已知厂商前缀 → 厂商身份。键为小写，命中即用。 */
const VENDOR_PREFIXES: Readonly<Record<string, VendorIdentity>> = {
  anthropic: { label: 'Anthropic', id: 'anthropic' },
  openai: { label: 'OpenAI', id: 'openai' },
  google: { label: 'Google', id: 'google' },
  deepseek: { label: 'DeepSeek', id: 'deepseek' },
  qwen: { label: 'Qwen', id: 'qwen' },
  moonshot: { label: 'Moonshot', id: 'moonshot' },
  moonshotai: { label: 'Moonshot', id: 'moonshot' },
  minimax: { label: 'MiniMax', id: 'minimax' },
  'z-ai': { label: 'Z.AI', id: 'zhipu' },
  zai: { label: 'Z.AI', id: 'zhipu' },
  zhipu: { label: 'Z.AI', id: 'zhipu' },
  xiaomi: { label: 'Xiaomi', id: 'xiaomimimo' },
  tencent: { label: 'Tencent', id: 'tencent' },
  stepfun: { label: 'StepFun', id: 'stepfun' },
  nvidia: { label: 'NVIDIA', id: 'nvidia' },
  meta: { label: 'Meta', id: 'meta' },
  sakana: { label: 'Sakana AI', id: 'sakana' },
  upstage: { label: 'Upstage', id: 'upstage' },
  inclusionai: { label: 'InclusionAI', id: '' },
  'x-ai': { label: 'xAI', id: 'xai' },
  xai: { label: 'xAI', id: 'xai' },
  mistral: { label: 'Mistral', id: 'mistral' },
  mistralai: { label: 'Mistral AI', id: 'mistral' },
  cohere: { label: 'Cohere', id: 'cohere' },
  perplexity: { label: 'Perplexity', id: 'perplexity' },
  inception: { label: 'Inception', id: 'inception' },
  poolside: { label: 'Poolside', id: 'poolside' },
  reflection: { label: 'Reflection', id: 'reflection' },
  ornith: { label: 'Ornith', id: '' },
  openrouter: { label: 'OpenRouter', id: 'openrouter' },
  microsoft: { label: 'Microsoft', id: 'microsoft' },
  deepinfra: { label: 'DeepInfra', id: 'deepinfra' },
  ollama: { label: 'Ollama', id: 'ollama' },
  llamacpp: { label: 'Local', id: '' },
  lmstudio: { label: 'LM Studio', id: 'lmstudio' },
};

/**
 * 模型主体前缀 → 厂商身份。
 *
 * 【为什么需要】自定义 provider（当前 `cpa`）给出的 ID **没有厂商前缀**（如 `gemini-3.8-flash`），
 * 而有些代理的"前缀"是路由分组名（如 `group/deepseek-v4.1-flash` 的 `group`），不是厂商。
 * 两种情况都必须回落到主体名推断，否则用户会看到"group"这种内部标识当厂商。
 */
const MODEL_PREFIX_VENDORS: ReadonlyArray<readonly [RegExp, VendorIdentity]> = [
  [/^(?:claude|opus|sonnet|haiku|fable)/i, { label: 'Anthropic', id: 'anthropic' }],
  [/^(?:gpt|o1|o3|o4)(?:[-.]|$)/i, { label: 'OpenAI', id: 'openai' }],
  [/^(?:gemini|gemma)/i, { label: 'Google', id: 'google' }],
  [/^grok/i, { label: 'xAI', id: 'xai' }],
  [/^glm/i, { label: 'Z.AI', id: 'zhipu' }],
  [/^kimi/i, { label: 'Moonshot', id: 'moonshot' }],
  [/^qwen/i, { label: 'Qwen', id: 'qwen' }],
  [/^deepseek/i, { label: 'DeepSeek', id: 'deepseek' }],
  [/^minimax/i, { label: 'MiniMax', id: 'minimax' }],
  [/^mimo/i, { label: 'Xiaomi', id: 'xiaomimimo' }],
  [/^nemotron/i, { label: 'NVIDIA', id: 'nvidia' }],
  [/^(?:llama|muse-spark)/i, { label: 'Meta', id: 'meta' }],
  [/^mistral/i, { label: 'Mistral', id: 'mistral' }],
  [/^mercury/i, { label: 'Inception', id: 'inception' }],
  [/^laguna/i, { label: 'Poolside', id: 'poolside' }],
  [/^solar/i, { label: 'Upstage', id: 'upstage' }],
  [/^(?:beam|fugu)/i, { label: 'Reflection', id: 'reflection' }],
  [/^hy\d/i, { label: 'Tencent', id: 'tencent' }],
  [/^step-/i, { label: 'StepFun', id: 'stepfun' }],
];

/**
 * 全部已知厂商的图标 slug（去重、去空、按字母序）。
 *
 * 【设计意图 (Why)】
 *   core 与 ui 是两套包：core 说"这个厂商叫 zhipu"，ui 说"zhipu 有没有图标"。
 *   两边一旦漂移，症状是**静默降级成首字母徽标**（不报错、不破图），几乎不可能被发现。
 *   因此把厂商 slug 集合作为公开权威导出，让 ui 侧能用一条机械断言守住「每个已知厂商都能查到图标」。
 */
export const MODEL_VENDOR_IDS: readonly string[] = Array.from(
  new Set(
    [...Object.values(VENDOR_PREFIXES), ...MODEL_PREFIX_VENDORS.map(([, identity]) => identity)]
      .map((identity) => identity.id)
      .filter(Boolean),
  ),
).sort();

const titleCase = (text: string): string => text.replace(/\b\w/g, (char) => char.toUpperCase()).trim();

function applyVendorCasing(text: string): string {
  let cased = text.replace(PARAMETER_COUNT, (_match, prefix: string, size: string) => `${prefix.toUpperCase()}${size}B`);
  for (const [pattern, replacement] of VENDOR_CASING) {
    cased = cased.replace(pattern, replacement);
  }
  return cased;
}

/**
 * 剥离厂商/路由前缀：取最后一个 `/` 之后的部分。
 *
 * 【规则】`group/deepseek-v4.1-flash` 的 `group` 是代理分组名，不是厂商；
 * 真正可读的主体在斜杠之后，所以显示层一律取末段。厂商判定另走 `resolveModelVendor`。
 */
export function stripProviderPrefix(modelId: string): string {
  const trimmed = modelId.trim();
  const slash = trimmed.lastIndexOf('/');
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

/**
 * 判定数字尾巴是否像日期快照。
 *
 * 【设计意图 (Why)】
 *   只认 8 位 `YYYYMMDD`。
 *
 * 【防范的历史坑 (Pitfall)】
 *   曾按 4 位 `MMDD` 判定，`grok-4.20-0309-reasoning` 的 `0309` 被当成 3 月 9 日从主体名剥离；
 *   剥掉后剩余 `grok-4.20` 与 `grok-4.20-0309-non-reasoning` 派生出几乎相同的名字。
 *   4 位数字与版本快照无法可靠区分，宁可让它作为主体的一部分原样保留。
 *
 * 【约束与规则 (Rules)】
 *   宁可保留一个长一点的版本号，也绝不误剥有区分度的标识。
 */
function looksLikeDatePin(digits: string): boolean {
  if (digits.length !== 8) return false;
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/**
 * 拆分尾部标签：变体、量化、上下文窗口、日期快照、路由后缀。
 *
 * 【规则】循环剥离直到稳定——`…-flash-Q4_K_XL` 与 `…-Q4_K_XL-flash` 是同一个模型，
 * 两种书写顺序都必须走到同一个「主体 + Flash + Q4_K_XL」结果。
 * 拆出来的每一段都会由 `parseModelDisplay` **原样拼回 `name`**，绝不丢弃。
 */
function splitTrailingTags(rawBase: string): {
  base: string;
  variant: string;
  quant: string;
  context: string;
  route: string;
  date: string;
} {
  let base = rawBase.trim();
  let variant = '';
  let quant = '';
  let context = '';
  let route = '';
  let date = '';

  // 1. 路由后缀 `:US` / `:free`（Nous / OpenRouter 区域与免费层路由），最后一段才算。
  const routeMatch = base.match(/:([A-Za-z0-9_-]{1,16})$/);
  if (routeMatch) {
    route = routeMatch[1];
    base = base.slice(0, -routeMatch[0].length);
  }

  for (let progress = true; progress; ) {
    progress = false;

    if (!context) {
      // Anthropic 的 `[1m]` 路由后缀选择 1M 上下文窗口，是同一模型的变体
      const contextMatch = base.match(/\[(\d+[mk])\]$/i);
      if (contextMatch) {
        context = contextMatch[1].toUpperCase();
        base = base.slice(0, -contextMatch[0].length);
        progress = true;
      }
    }

    if (!variant) {
      for (const [pattern, label] of VARIANT_TAGS) {
        if (pattern.test(base)) {
          variant = label;
          base = base.replace(pattern, '');
          progress = true;
          break;
        }
      }
    }

    if (!quant) {
      const quantMatch = base.match(QUANT_SUFFIX);
      if (quantMatch) {
        // 保留完整量化档位：`Q4_K_M` / `Q4_K_S` / `Q8_0` / `BF16` 是不同权重，
        // 截断成 `Q4` 会让同一个模型的两个量化版本无法区分。
        quant = quantMatch[1].toUpperCase();
        base = base.slice(0, -quantMatch[0].length);
        // 量化已确认是本地构建，Instruct/Chat 标记对用户是噪声
        base = base.replace(/-(?:Instruct|Chat)(?:-\d{4})?$/i, '');
        progress = true;
      }
    }

    if (progress) continue;

    const dateMatch = base.match(/-(\d{4}|\d{8})$/);
    if (dateMatch && looksLikeDatePin(dateMatch[1])) {
      date = dateMatch[1];
      base = base.slice(0, -dateMatch[0].length);
      progress = true;
    }
  }

  return { base, variant, quant, context, route, date };
}

/**
 * 主体名的可读化：按厂商家族分派规则。
 *
 * 【规则】`claude-*` 的版本号在 ID 里用连字符（`haiku-4-5` / `fable-5-1`），
 * 人类写法是点号（`Haiku 4.5`），必须单独处理；其余家族统一
 * 「连字符换空格 + 首字母大写 + 品牌大小写」。
 */
function prettifyBase(base: string): string {
  if (/^claude-/i.test(base)) {
    const stripped = base
      .replace(/^claude-/i, '')
      .replace(/(\d)-(?=\d)/g, '$1.')
      .replace(/-/g, ' ');

    // 【规则】旧版 Anthropic ID 把版本号放在家族词**之前**（`claude-3-7-sonnet` → `3.7 sonnet`），
    // 而人类写法是「家族 + 版本」（`Sonnet 3.7`）。新版 ID（`claude-opus-4-8`）本身已是正确顺序，
    // 因此只在「首词是纯版本号、次词是家族名」时才交换，其余形态原样保留。
    const swapped = stripped.replace(
      /^(\d+(?:\.\d+)*)\s+([A-Za-z][A-Za-z0-9.]*)(.*)$/,
      (_match, version: string, family: string, tail: string) => `${family} ${version}${tail}`,
    );

    return applyVendorCasing(titleCase(swapped));
  }

  if (/^gpt-/i.test(base)) {
    // 【增强】官方桌面端只把首个 gpt 换成 GPT- 保留其余连字符，得到 `GPT-6-astra-pro`
    // 这种仍然机器感的串；这里把版本号之后的连字符也转为空格，得到 `GPT-6 Astra Pro`。
    const rest = base.replace(/^gpt-/i, '');
    return `GPT-${applyVendorCasing(titleCase(rest.replace(/-/g, ' ')))}`;
  }

  // 【规则】`glm-5-3` 这类「大版本-小版本」连字符是版本号，人类写法是点号。
  // 只匹配**结尾**的两位数对，避免误伤 `llama-3-70b`（70b 是参数量）等形态。
  const dotted = base.replace(/-(\d{1,2})-(\d{1,2})$/, '-$1.$2');

  return applyVendorCasing(titleCase(dotted.replace(/-/g, ' ')));
}

/**
 * 厂商身份判定：优先 ID 前缀，其次主体名推断。
 *
 * 【规则】
 *   - 前缀直接命中厂商表即用；
 *   - 代理型前缀（`xai-oauth` / `deepseek-direct`）按 `-` 拆段再匹配一次，
 *     因为这类 slug 是「厂商 + 认证方式」的复合体，厂商仍在首段；
 *   - `group` / `custom` 是路由分组名，不是厂商，继续回落到主体名推断；
 *   - 三者都判不出时返回 null，由调用方决定回退文案（展示名回退 provider，图标则留空）。
 */
function resolveVendorIdentity(modelId: string): VendorIdentity | null {
  const trimmed = modelId.trim();
  const slash = trimmed.lastIndexOf('/');
  const prefix = slash >= 0 ? trimmed.slice(0, slash).trim().toLowerCase() : '';
  const base = stripProviderPrefix(trimmed);

  if (prefix && VENDOR_PREFIXES[prefix]) {
    return VENDOR_PREFIXES[prefix];
  }

  for (const [pattern, identity] of MODEL_PREFIX_VENDORS) {
    if (pattern.test(base)) {
      return identity;
    }
  }

  if (prefix && prefix !== 'group' && prefix !== 'custom') {
    for (const segment of prefix.split('-')) {
      if (VENDOR_PREFIXES[segment]) return VENDOR_PREFIXES[segment];
    }
    // 未知前缀仍按原文作为展示名（保持历史行为），但没有图标可用
    return { label: prefix, id: '' };
  }

  return null;
}

/**
 * 厂商展示名判定。
 *
 * 【规则】判不出真实厂商时回退 provider 名——它至少能告诉用户"这个模型挂在哪个入口下"，
 * 比留空更可用。图标场景不适用这条回退（见 `resolveModelVendorId`）。
 */
export function resolveModelVendor(modelId: string, providerName = ''): string {
  const identity = resolveVendorIdentity(modelId);
  return identity ? identity.label : providerName.trim();
}

/**
 * 厂商图标标识判定（模型维度）。
 *
 * 【设计意图 (Why)】
 *   UI 需要一个**稳定、无空格、与图标文件名一致**的 slug 才能查表渲染品牌图标，
 *   展示名（`Z.AI` / `Mistral AI` / `Sakana AI`）带空格与标点，不能当键。
 *
 * 【约束与规则 (Rules)】
 *   - 判不出厂商时返回空串，**绝不回退 provider 名**：`cpa` / `nous` 是接入入口而非厂商，
 *     硬套一个图标等于给用户错误归属；
 *   - 已知厂商但上游没有官方图标（`InclusionAI` / `Ornith` / 本地 llamacpp）同样返回空串，
 *     由 UI 降级为首字母 badge；
 *   - 纯函数，零副作用。
 */
export function resolveModelVendorId(modelId: string, providerName = ''): string {
  // 【规则】厂商身份只由模型 ID 决定；providerName 保留在签名里是为了让调用方
  // 在两个函数间切换时不必改参数，不参与任何判定。
  void providerName;
  const identity = resolveVendorIdentity(modelId);
  return identity ? identity.id : '';
}

/**
 * 「转发型入口」标记词：出现在 provider slug/展示名的**某一段**里，说明它是兼容/代理/聚合入口，
 * 实际背后可能跑任意厂商，不能按名字给它挂厂商图标。
 */
const FORWARDING_TOKENS: ReadonlySet<string> = new Set([
  'compatible',
  'proxy',
  'aggregator',
  'relay',
  'router',
  'gateway',
  'mirror',
]);

/**
 * 厂商图标标识判定（provider 维度）。
 *
 * 【为什么需要】选择器的分组标题按 provider 聚合，标题行需要 provider 自身标识；
 * 而 provider slug 与模型 ID 前缀是两套命名（`nous` / `cpa` / `xai-oauth`），
 * 只能从 slug 与展示名里逐段找已知厂商，找不到就降级。
 *
 * 【规则】
 *   - 只认完整段匹配，禁止子串模糊匹配——`nousresearch` 里含 `nous` 不代表它是 Nous 厂商图标；
 *   - 含 `compatible` / `proxy` / `aggregator` 等字样的串整条跳过：这类是「兼容/聚合入口」，
 *     它们**转发**多家模型，把入口名命中的厂商 logo 挂上去等于给用户错误归属
 *     （`openai-compatible` 实际可能跑着 DeepSeek，绝不能显示 OpenAI 的标识）；
 *   - 判不出返回空串，由调用方决定降级或省略。
 */
export function resolveProviderVendorId(providerSlug: string, providerName = ''): string {
  const tokens = (raw: string): string[] =>
    (raw || '').trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (const raw of [providerSlug, providerName]) {
    const parts = tokens(raw);
    if (parts.length === 0) continue;
    // 【规则】必须按 **段** 判转发语义，不能按子串：`openrouter` 里含 `router`，
    // 但它是货真价实的接入商；而 `openai-compatible` / `deepseek-proxy` 的段里
    // 才真正携带「我在转发」的语义。
    if (parts.some((token) => FORWARDING_TOKENS.has(token))) continue;
    for (const token of parts) {
      const identity = VENDOR_PREFIXES[token];
      if (identity) return identity.id;
    }
  }
  return '';
}

/**
 * 完整拆解一个模型 ID，产出可直接渲染的显示部件。
 *
 * 【设计意图 (Why)】
 *   `name` 必须是**完整可读名**：ID 里有的词一个都不能少。
 *   `gemini-3.8-flash` 就叫 `Gemini 3.8 Flash`，不能因为把 Flash 标明成标签
 *   就从名字里删掉——用户认的是完整型号名，标签只是强调，不是替代。
 *
 * 【防范的历史坑 (Pitfall)】
 *   曾把变体/日期/量化从 `name` 里剥掉、只放在独立字段，导致：
 *   - 选择器主体名显示 `Gemini 3.8`，用户以为是另一个模型；
 *   - `-fast` / `-thinking` 只在标签里出现，窄容器裁掉标签后名字就失真；
 *   - 两个不同型号（`-0309-reasoning` / `-0309-non-reasoning`）主体名撞车。
 *
 * 【约束与规则 (Rules)】
 *   - `name` = 主体可读化 + 全部尾部标签按 ID 原始顺序拼回
 *     （主体 → 日期 → 变体 → 量化 → 上下文 → 路由），一个都不丢；
 *   - `variant` / `quant` / `context` / `route` / `date` 仍然解析出来，供 UI 做标签与筛选，
 *     但**不得**再从 `name` 里扣掉它们；
 *   - ID 无法解析时回退为原始 ID 原文，绝不返回空串。
 */
export function parseModelDisplay(modelId: string, providerName = ''): ModelDisplayParts {
  const trimmed = (modelId ?? '').trim();
  if (!trimmed) {
    return { name: '', variant: '', quant: '', context: '', route: '', date: '', vendor: providerName.trim(), vendorId: '' };
  }

  const { base, variant, quant, context, route, date } = splitTrailingTags(stripProviderPrefix(trimmed));
  const head = prettifyBase(base);

  // 【规则】路由后缀 `:free` 是全小写词，嵌进名字里读起来像断句；统一首字母大写（`Free`）。
  // `:US` 这类已大写的区域码保持原样。
  const routeLabel = /^[a-z]+$/.test(route) ? route[0].toUpperCase() + route.slice(1) : route;

  // 【顺序】与 ID 的自然书写顺序一致，保证 `grok-4.20-0309-reasoning` → `Grok 4.20 0309 Reasoning`
  const name = [head, date, variant, quant, context, routeLabel].filter(Boolean).join(' ') || trimmed;

  return {
    name,
    variant,
    quant,
    context,
    route,
    date,
    vendor: resolveModelVendor(trimmed, providerName),
    vendorId: resolveModelVendorId(trimmed, providerName),
  };
}

/**
 * 单行显示名。
 *
 * 【规则】与 `parseModelDisplay().name` 完全一致——变体已经在名字里，
 * 不允许再额外拼接 ` · 变体`，否则会出现 `Gemini 3.8 Flash · Flash` 这种重复。
 */
export function formatModelDisplayName(modelId: string, providerName = ''): string {
  return parseModelDisplay(modelId, providerName).name;
}

/** 变体标签单取，供选择器逐行渲染标签而无需重算整条显示名。 */
export function modelVariantTag(modelId: string): string {
  return parseModelDisplay(modelId).variant;
}
