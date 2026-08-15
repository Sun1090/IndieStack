/**
 * 安全重定向工具
 *
 * 防止开放重定向（Open Redirect）攻击：
 * 登录/回调等场景会读取 URL 参数（redirect / next）作为跳转目标，
 * 若不做校验，攻击者可构造 https://app.com/auth/login?redirect=https://evil.com
 * 将已登录用户引导到钓鱼站点。
 *
 * 仅允许站内相对路径（以单个 `/` 开头），排除：
 *   - 协议相对 URL：//evil.com、/\evil.com（含编码变体）
 *   - 绝对 URL：https://evil.com
 *   - 其他协议：javascript: 等
 */

/** 判断字符串是否为安全的站内相对路径 */
export function isSafeRelativePath(value: string): boolean {
  if (!value.startsWith("/")) return false;

  let decoded: string;
  try {
    // 防御编码绕过：/%5c%5cevil.com 等
    decoded = decodeURIComponent(value);
  } catch {
    return false;
  }

  // 排除 //evil.com 与 /\evil.com（浏览器会解析为协议相对 URL）
  if (decoded.startsWith("//") || decoded.startsWith("/\\")) return false;

  // 排除含有控制字符/换行的路径（避免响应拆分）
  if (/[\r\n\u0000-\u001f]/.test(decoded)) return false;

  return true;
}

/**
 * 安全读取重定向目标
 * @param value   URL 参数中读取的原始值（可能为 null/undefined）
 * @param fallback 不合法时的回退地址（通常是仪表盘或首页）
 */
export function getSafeRedirect(
  value: string | null | undefined,
  fallback: string
): string {
  if (typeof value === "string" && isSafeRelativePath(value)) {
    return value;
  }
  return fallback;
}
