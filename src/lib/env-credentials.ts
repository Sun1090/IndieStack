/**
 * 「这台机器到底配没配这个凭据」的判定层（纯函数，由 Vitest 覆盖）。
 *
 * ## 为什么它是独立模块，而不是留在 `preflight.ts` 里
 *
 * 起因是一连串同型的错，方向相反、根因同一个：
 *   - **假阴性**：IO 层只看 `process.env`，而 `node scripts/*` 不加载 `.env.local`
 *     （只有 Next 运行时加载）。于是 2026-10-25 的 `drills:preflight` 自信地报
 *     「B03 缺 SUPABASE_URL / SERVICE_ROLE_KEY」，而同一天用 `.env.local` 里那两个值
 *     打 `GET /auth/v1/admin/users` 返回 **200**。这句假登记顺着文档滚成了
 *     「缺外部凭据」，而它卡的是 v0.12.0 的 tag 前置。
 *   - **假阳性**：判据是「非空即有」，于是 `.env.local` 里从模板抄来的
 *     `SUPABASE_DB_URL=…@db.your-project.supabase.co/…` 被算成「凭据已有」。
 *
 * 同一天复现的第二批：`ops:migration-status`、`ops:digest-observation` 裸跑都报
 * 「读不到云端」，原因一模一样——**它们读的是 `process.env`，凭据在 `.env.local`**。
 * 这类「没去找」被写成「查不了」在本仓库已出现过至少四次（`supabase migration list`、
 * CodeQL 告警列表、`gh secret` 推能力、这次是 env 文件）。
 * ⇒ 修法不是逐个脚本打补丁，而是**共享一个读对了来源的取数口**。
 *
 * ## 三条规矩
 *
 *   1. **优先级**：`process.env` → `.env.local` → `.env.development.local`
 *      → `.env.development` → `.env`，与 Next 的加载顺序一致。`mergeEnvSources`
 *      是**先到先得**，所以名单必须按「具体 → 笼统」排（写反过一次：`.reverse()`
 *      让最不具体的 `.env` 赢）。
 *   2. **判「有没有」要能识别模板形态**：见 `credentialLooksConfigured`。
 *      只认明确可识别的占位符，**不做「像不像真密钥」的猜测**——
 *      猜出来的判定比非空判定更危险。
 *   3. **空字符串按「没有」处理**：`.env` 里写了 `KEY=` 是最常见的踩法。
 *
 * 本模块刻意**不读文件、不发请求**：读盘在 `scripts/lib/env-sources.js`，
 * 判定在这里——按本仓库惯例，只有进了 `src/lib/**` 才有单测兜底。
 */

/** 明确可识别的模板形态。注意都是小写比较。 */
const PLACEHOLDER_TOKENS = [
  "your-project",
  "your_project",
  "example.com",
  "changeme",
  "xxxxxx",
  "<",
  "${",
] as const;

const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

/**
 * JWT 形态的值要**解 payload 再判**，不能只看明文。
 *
 * 这不是「像不像真密钥」的猜测：Supabase 的 anon / service_role key 是 JWT，
 * `.env.example` 模板里那个 `ref` 就是 `your-project`，但它被 base64url 包在
 * payload 里，明文词表命中不到——**判据若漏掉这一型，就是它自己造出来的假阳性**
 * （2026-10-25 实测到，`.env.example` 第 23 行的真实模板值当时被判成「已配置」）。
 * 解不开（非合法 base64 / 非 JSON）就按原样判，不因此判成「未配置」：
 * 那是读不出形状，不是占位符。
 */
function jwtPayloadIsPlaceholder(value: string): boolean {
  if (!JWT_SHAPE.test(value)) return false;
  try {
    const payload = Buffer.from(value.split(".")[1] ?? "", "base64url").toString("utf8");
    const lowered = payload.toLowerCase();
    return PLACEHOLDER_TOKENS.some((token) => lowered.includes(token));
  } catch {
    return false;
  }
}

/** 判一个环境变量值算不算「已配置」（非空 且 不是可识别的模板形态）。 */
export function credentialLooksConfigured(value: string | undefined): boolean {
  const trimmed = (value ?? "").trim();
  if (trimmed.length === 0) return false;
  const lowered = trimmed.toLowerCase();
  if (PLACEHOLDER_TOKENS.some((token) => lowered.includes(token))) return false;
  return !jwtPayloadIsPlaceholder(trimmed);
}

/**
 * 解析 dotenv 形态的文本成键值表（纯函数，供 IO 层合并 env 文件用）。
 *
 * 只认本仓库实际用的写法：`KEY=value`、`#` 注释、空行、可选 `export` 前缀、
 * 成对的单/双引号包裹。**刻意不实现**多行值与变量插值——
 * 探测只问「这个键有没有被配成一个不像占位符的值」，
 * 把 shell 的完整语义搬进来只会多出一处没人测的解析面。
 */
export function parseEnvFileText(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eq = withoutExport.indexOf("=");
    if (eq <= 0) continue;
    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = withoutExport.slice(eq + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length > 1 && value.endsWith(quote)) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

/**
 * 合并多份来源，后者不覆盖已配上的值：**判据是「有没有」而不是「谁赢」**。
 * `process.env` 由调用方放在最前面，所以它优先。
 */
export function mergeEnvSources(sources: readonly Record<string, string | undefined>[]): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (typeof value !== "string") continue;
      if (!(key in merged) || !credentialLooksConfigured(merged[key])) merged[key] = value;
    }
  }
  return merged;
}

/** Next.js 会自动加载、而 `node scripts/*` 不会的那批文件名。**顺序即优先级**。 */
export const ENV_FILE_NAMES = [
  ".env.local",
  ".env.development.local",
  ".env.development",
  ".env",
] as const;
