/**
 * localStorage 安全读写原语（隐私模式 / 禁用站点数据 / opaque origin / 配额超限）。
 *
 * 设计意图 (Why)：
 *   上述环境下访问 `window.localStorage` 的 accessor getter 与 `setItem` 均可能抛
 *   `SecurityError`，配额写满抛 `QuotaExceededError`。任一处裸写抛错都会截断其后的
 *   `deps.render()`，用户可见后果是「点了没反应」而控制台之外毫无线索。
 *   把兜底收敛到单一原语，避免各服务各写一套（当前仓内已有 5 处重复实现）。
 *
 * 防范的历史坑 (Pitfall)：
 *   P-032 —— 设置中心与连接回写路径在 `render()` 之前裸调 `localStorage.setItem`，
 *   隐私模式下异常冒泡跳过整次界面刷新；内存态已更新但界面不变，排查成本极高。
 *
 * 约束与规则 (Rules)：
 *   1. `typeof` 判定必须并入 try：禁用站点数据时求值 `typeof localStorage` 本身就会抛，
 *      放在 try 之外等于没有守卫；
 *   2. 写入失败必须用返回值表达，禁止静默成 void —— 调用方据此决定是否提示用户；
 *   3. 禁止重试：配额满时重写同一 key 必然再次失败；
 *   4. 错误类型用 `error.name` 字符串判定，禁止 `instanceof DOMException`
 *      （跨 realm / Node 测试桩下不成立）。
 */

export type StorageWriteFailure = { readonly ok: true } | { readonly ok: false; readonly reason: 'unavailable' | 'quota' | 'security'; readonly error: unknown };

const readErrorName = (error: unknown): string => {
  const name = (error as { name?: unknown } | null | undefined)?.name;
  return typeof name === 'string' ? name : '';
};

/** 各引擎命名不同：Chromium / Safari 为 QuotaExceededError，Firefox 为 NS_ERROR_DOM_QUOTA_REACHED。 */
const isQuotaError = (name: string): boolean => name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';

/**
 * 读取偏好；存储不可读时按「无已保存值」处理。
 * 【规则】读取失败只影响偏好恢复，界面回落默认值即可，不向用户提示。
 */
export function safeGetItem(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  // gate-degrade: 存储不可读时按无已保存值处理，界面回落默认偏好
  } catch {
    return null;
  }
}

/** 写入目标的最小接口：允许注入 Storage 替身（测试桩 / 内存实现）。 */
export type StorageWriteTarget = { setItem(key: string, value: string): void };

/**
 * 写入偏好；失败时返回结构化原因，由调用方决定可观测策略。
 * 【规则】不抛异常、不重试；`unavailable` 表示非浏览器环境（单测 / SSR），不属降级。
 * 【约束】`storage` 为 undefined 时才探测全局 localStorage（探测在 try 内，
 *   因为禁用站点数据时求值 `typeof localStorage` 本身就会抛）；显式传入替身则优先使用。
 */
export function safeSetItem(key: string, value: string, storage?: StorageWriteTarget): StorageWriteFailure {
  try {
    const target = storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
    if (!target) {
      return { ok: false, reason: 'unavailable', error: null };
    }
    target.setItem(key, value);
    return { ok: true };
  // gate-degrade: 存储不可写时必须把失败返回给调用方，禁止吞成成功
  } catch (error) {
    return { ok: false, reason: isQuotaError(readErrorName(error)) ? 'quota' : 'security', error };
  }
}
