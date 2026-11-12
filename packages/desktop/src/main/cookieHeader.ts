/**
 * 从网关登录响应头提取纯 `name=value` 格式的 Cookie 请求头。
 *
 * 【设计意图 (Why)】
 *   网关下发的 `Set-Cookie` 包含 `; Path=/; HttpOnly; SameSite=Lax` 等响应属性，
 *   后续请求仅能携带 `name=value` 键值对；Electron 主进程与浏览器代理须遵守同一解析口径。
 */
export function extractCookieHeader(headers: Headers): string {
  const headersWithCookies = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headersWithCookies.getSetCookie === 'function') {
    return headersWithCookies
      .getSetCookie()
      .map((c) => c.split(';')[0].trim())
      .filter(Boolean)
      .join('; ');
  }
  const rawCookie = headers.get('set-cookie') || '';
  return rawCookie ? rawCookie.split(';')[0].trim() : '';
}
