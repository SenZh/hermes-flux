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

/** 已知厂商前缀 → 展示名。键为小写，命中即用。 */
const VENDOR_LABELS: Readonly<Record<string, string>> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  moonshot: 'Moonshot',
  moonshotai: 'Moonshot',
  minimax: 'MiniMax',
  'z-ai': 'Z.AI',
  zai: 'Z.AI',
  xiaomi: 'Xiaomi',
  tencent: 'Tencent',
  stepfun: 'StepFun',
  nvidia: 'NVIDIA',
  meta: 'Meta',
  sakana: 'Sakana AI',
  upstage: 'Upstage',
  inclusionai: 'InclusionAI',
  'x-ai': 'xAI',
  xai: 'xAI',
  mistral: 'Mistral',
  mistralai: 'Mistral AI',
  cohere: 'Cohere',
  perplexity: 'Perplexity',
  inception: 'Inception',
  poolside: 'Poolside',
  reflection: 'Reflection',
  ornith: 'Ornith',
  openrouter: 'OpenRouter',
  microsoft: 'Microsoft',
  deepinfra: 'DeepInfra',
  ollama: 'Ollama',
  llamacpp: 'Local',
  lmstudio: 'LM Studio',
};

/**
 * 模型主体前缀 → 厂商展示名。
 *
 * 【为什么需要】自定义 provider（当前 `cpa`）给出的 ID **没有厂商前缀**（如 `gemini-3.8-flash`），
 * 而有些代理的"前缀"是路由分组名（如 `group/deepseek-v4.1-flash` 的 `group`），不是厂商。
 * 两种情况都必须回落到主体名推断，否则用户会看到"group"这种内部标识当厂商。
 */
const MODEL_PREFIX_VENDORS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(?:claude|opus|sonnet|haiku|fable)/i, 'Anthropic'],
  [/^(?:gpt|o1|o3|o4)(?:[-.]|$)/i, 'OpenAI'],
  [/^(?:gemini|gemma)/i, 'Google'],
  [/^grok/i, 'xAI'],
  [/^glm/i, 'Z.AI'],
  [/^kimi/i, 'Moonshot'],
  [/^qwen/i, 'Qwen'],
  [/^deepseek/i, 'DeepSeek'],
  [/^minimax/i, 'MiniMax'],
  [/^mimo/i, 'Xiaomi'],
  [/^nemotron/i, 'NVIDIA'],
  [/^(?:llama|muse-spark)/i, 'Meta'],
  [/^mistral/i, 'Mistral'],
  [/^mercury/i, 'Inception'],
  [/^laguna/i, 'Poolside'],
  [/^solar/i, 'Upstage'],
  [/^(?:beam|fugu)/i, 'Reflection'],
  [/^hy\d/i, 'Tencent'],
  [/^step-/i, 'StepFun'],
];

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
 * 厂商判定：优先 ID 前缀，其次主体名推断，最后回退原始前缀/provider 名。
 *
 * 【规则】前缀命中 `VENDOR_LABELS` 直接用；否则（无前缀的自定义 provider、或 `group` 这类
 * 代理分组名）按主体名推断；两者都判不出时，仅当存在真实前缀才回退为前缀原文。
 */
export function resolveModelVendor(modelId: string, providerName = ''): string {
  const trimmed = modelId.trim();
  const slash = trimmed.lastIndexOf('/');
  const prefix = slash >= 0 ? trimmed.slice(0, slash).trim().toLowerCase() : '';
  const base = stripProviderPrefix(trimmed);

  if (prefix && VENDOR_LABELS[prefix]) {
    return VENDOR_LABELS[prefix];
  }

  for (const [pattern, vendor] of MODEL_PREFIX_VENDORS) {
    if (pattern.test(base)) {
      return vendor;
    }
  }

  if (prefix) {
    // 形如 `group/...` 的代理分组名不是厂商，回退 provider 名由 UI 兜底
    if (prefix === 'group' || prefix === 'custom') {
      return providerName.trim();
    }
    return prefix;
  }

  return providerName.trim();
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
    return { name: '', variant: '', quant: '', context: '', route: '', date: '', vendor: providerName.trim() };
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
