/**
 * 左轨活动指示器（ActivityIndicator）动效变体的唯一真值表与本地偏好。
 *
 * 设计意图(Why)：
 *   变体枚举原本定义在表现组件 `components-react/primitives/ActivityIndicator.tsx` 内部，
 *   设置页、宿主与偏好层都要引用它，跨层引用组件文件会让"表现组件"反向成为数据真值。
 *   这里把枚举、展示顺序与持久化收敛到 tokens 层，三层只认这一份。
 *
 * 防范的历史坑(Pitfall)：
 *   1. localStorage 在隐私模式下读写会抛错，必须降级为默认值而不是让启动失败；
 *   2. 持久化必须只认白名单内的值，脏数据（手改 localStorage / 旧版本残留）不得写进 DOM，
 *      否则 `flux-variant-xxx` 类名不存在，指示器会退化成"什么都没有"。
 *
 * 约束与规则(Rules)：
 *   1. 存储键统一使用 hermes_flux_* 前缀，与字体偏好一致；
 *   2. 展示顺序即设置页卡片顺序，新增变体只改本文件（组件分支仍需补对应结构）；
 *   3. 本文件零 DOM 结构、零 React 依赖，可被单测直接导入。
 */

/**
 * 变体真值表：顺序即设置页展示顺序，首项为默认值。
 *
 * 【为什么先声明数组再推导类型】枚举与列表若并列写两遍，会存在「联合多了值、数组漏了项」
 *   这种编译器不拦的组合：设置页少一张卡却仍然编译通过，用户永远选不到该变体。
 *   单向推导后，新增变体只改这一行，类型与展示面同时收敛。
 */
export const ACTIVITY_INDICATOR_VARIANTS = [
  'cloud',
  'gyro',
  'orbit',
  'synapse',
  'spring',
  'matrix',
] as const;

export type ActivityIndicatorVariant = (typeof ACTIVITY_INDICATOR_VARIANTS)[number];

export const DEFAULT_ACTIVITY_INDICATOR_VARIANT: ActivityIndicatorVariant = ACTIVITY_INDICATOR_VARIANTS[0];

export const ACTIVITY_INDICATOR_STORAGE_KEY = 'hermes_flux_activity_variant';

const VARIANT_SET = new Set<string>(ACTIVITY_INDICATOR_VARIANTS);

/**
 * 把任意输入收敛为合法变体。
 * 【规则】未知值、空值、非字符串一律回落到默认值，禁止让脏值流到类名上。
 */
export function resolveActivityIndicatorVariant(
  value: string | null | undefined,
): ActivityIndicatorVariant {
  // SAFETY: [narrowed-by] VARIANT_SET.has() 已证明该字符串是变体真值表成员
  return typeof value === 'string' && VARIANT_SET.has(value)
    ? (value as ActivityIndicatorVariant)
    : DEFAULT_ACTIVITY_INDICATOR_VARIANT;
}

export function loadActivityIndicatorVariant(): ActivityIndicatorVariant {
  let raw: string | null = null;
  try {
    raw = typeof localStorage === 'undefined'
      ? null
      : localStorage.getItem(ACTIVITY_INDICATOR_STORAGE_KEY);
  // gate-degrade: 隐私模式下读取 localStorage 会抛错，缺失偏好回落默认值属可选增强失败
  } catch {
    raw = null;
  }
  return resolveActivityIndicatorVariant(raw);
}

export function saveActivityIndicatorVariant(variant: ActivityIndicatorVariant): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ACTIVITY_INDICATOR_STORAGE_KEY, resolveActivityIndicatorVariant(variant));
    }
  // gate-degrade: 写入失败时偏好只在本次会话生效，不阻断界面
  } catch {
    // 写入失败不影响当前渲染
  }
}
