/**
 * GoTrue 会话 id 提取（v0.5.0 D02）
 * access token JWT payload 携带 session_id claim（Supabase Auth v2），
 * 作为 user_sessions.id 实现设备行与真实会话的一一对应。
 */
export function sessionIdFromAccessToken(accessToken: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString());
    const sid = (payload as { session_id?: string }).session_id;
    return typeof sid === "string" && sid ? sid : null;
  } catch {
    return null;
  }
}
