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
 *   2. 展示顺序即设置页卡片顺序，新增变体只改本文件（组件分支或点云真值表同步登记）；
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
  'abyss-whale',
  'prolate-lattice',
  'infinity-knot',
  'surf-ribbon',
  'twin-vortex',
  'kinetic-helix',
  'whale-compact',
  'torus-mesh',
  'wave-net',
  'sphere-mesh',
  'mobius-band',
  'dipole-vortex',
] as const;

export type ActivityIndicatorVariant = (typeof ACTIVITY_INDICATOR_VARIANTS)[number];

export type PointCloudShape = 'wide' | 'sq';

export interface PointCloudSpec {
  readonly id: ActivityIndicatorVariant;
  readonly code: string;
  readonly shape: PointCloudShape;
  readonly dotCount: number;
}

/**
 * 12 套 3D 点云动态装置规格真值表（6 套 30×16 宽幅 + 6 套 18×18 紧凑）。
 *
 * 设计意图 (Why)：
 *   点云粒子数量、画布宽高比与 CSS 类前缀由单一规格表驱动，
 *   ActivityIndicator 组件按表循环生成纯 <i> 粒子节点，与 CSS 生成器 1:1 对齐，
 *   避免逐个手写重复 JSX 分支导致数量或类名前缀漂移。
 *
 * 约束与规则 (Rules)：
 *   code 与 CSS 类 `.flux-pc-<code>-<i>` 绑定；修改点数须同步重跑 generate-point-cloud-css.mjs。
 */
export const POINT_CLOUD_SPECS: readonly PointCloudSpec[] = [
  { id: 'abyss-whale', code: 'g', shape: 'wide', dotCount: 26 },
  { id: 'prolate-lattice', code: 'h', shape: 'wide', dotCount: 28 },
  { id: 'infinity-knot', code: 'i', shape: 'wide', dotCount: 26 },
  { id: 'surf-ribbon', code: 'j', shape: 'wide', dotCount: 24 },
  { id: 'twin-vortex', code: 'k', shape: 'wide', dotCount: 26 },
  { id: 'kinetic-helix', code: 'l', shape: 'wide', dotCount: 24 },
  { id: 'whale-compact', code: 'a', shape: 'sq', dotCount: 18 },
  { id: 'torus-mesh', code: 'b', shape: 'sq', dotCount: 20 },
  { id: 'wave-net', code: 'c', shape: 'sq', dotCount: 16 },
  { id: 'sphere-mesh', code: 'd', shape: 'sq', dotCount: 20 },
  { id: 'mobius-band', code: 'e', shape: 'sq', dotCount: 18 },
  { id: 'dipole-vortex', code: 'f', shape: 'sq', dotCount: 18 },
] as const;

export const POINT_CLOUD_SPEC_MAP: Readonly<Partial<Record<ActivityIndicatorVariant, PointCloudSpec>>> = (() => {
  const map: Partial<Record<ActivityIndicatorVariant, PointCloudSpec>> = {};
  for (const spec of POINT_CLOUD_SPECS) {
    map[spec.id] = spec;
  }
  return map;
})();

export function getPointCloudSpec(variant: ActivityIndicatorVariant): PointCloudSpec | undefined {
  return Object.hasOwn(POINT_CLOUD_SPEC_MAP, variant) ? POINT_CLOUD_SPEC_MAP[variant] : undefined;
}

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
