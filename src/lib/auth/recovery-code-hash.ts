/**
 * 恢复码的服务端哈希（CWE-916：低计算强度的口令哈希）
 *
 * 为什么要换掉 SHA-256：恢复码是 8 位、字母表 31 个字符、去掉易混淆字符，
 * 熵只有 log2(31^8) ≈ 39.6 位（每个用户 10 张码，命中任意一张 ≈ 43.0 位）。
 * 这**不是口令**，但它在系统里起的作用就是口令——兑换成功会解绑全部 TOTP 因子。
 * 未加盐的 SHA-256 让这个弱点可以**离线**利用：数据库一旦泄漏，攻击者不必打接口，
 * 所以限流和「需要已登录会话」都拦不住他。穷举 31^8 ≈ 8.53e11 个候选只要算纯 SHA-256，
 * 也就是说一次库泄漏换来的是「本地跑完 8.5e11 次哈希」这种量级的工作，而不是逐用户打接口。
 * **不折算成秒**：那需要攻击方硬件上的 SHA-256 吞吐，我没有测过，也不打算引用记忆里的基准。
 * 上一版注释在这里写了「hashcat mode 1400 单卡 22 GH/s ⇒ 39 秒」并附了一个论坛链接——
 * 那个吞吐数和那个 URL 都是我凭记忆拼出来的，从未打开过原文，因此整段删掉。
 * 本仓库把这类错误逐条登记在 `docs/progress.md` 的「坏探针 / 坏引用」台账里，这条是其中一例。
 *
 * 换成 scrypt 之后的两条变化，都只说能量到的部分：
 *   ① 每次猜测要付一次内存困难的派生：本档单次派生中位 208ms（见下表）；
 *   ② 每张码有独立随机盐，攻击者**不能**用一次计算同时比对同一用户的全部 10 行
 *      ——裸 SHA-256 恰好能被这样摊销。
 * **这里不写「因此需要 N 年」**：那需要 scrypt 在攻击方硬件上的吞吐，我没有测过。
 * 上面那条正是因为「凭记忆给外部数字安一个量级」被登记为坏引用，而这条注释本身又是同一
 * 形状的复发。所以这里的数字要么带算式、要么带打开过的原文，二者都做不到的就不写。
 *
 * ## 参数是怎么选的（含一次自我更正）
 *
 * 取 OWASP Password Storage Cheat Sheet 列出的五档「同等最低防护」之一，
 * 本实现用 `N=2^15 / r=8 / p=3`。原文逐字为：
 * 「These configuration settings provide a similar minimal level of defense, with the main
 * trade-off between parallelism and RAM usage.」
 *
 * **本文件上一版在这里写过一条错的取舍，现已用实测推翻**：它声称
 * 「兑换路径串行，所以低 N 高 p 更慢——`N=2^13/p=10` 实测 3.24 秒，本档 1.99 秒」。
 * 那个 3.24 秒不是实测，是把另一段脚本的读数记错了；按本文件实现重跑，`2^13/p=10`
 * 串行 10 张是 **1.60 秒**，比本档的 **1.99 秒**更快，RSS 也更少（+13 vs +37 MiB）。
 * 也就是说：**成本不构成选本档的理由**，原来的取舍陈述整条作废。
 *
 * 现在保留 `N=2^15/p=3` 的理由只剩一条，而且是内存而非时间：单次派生的
 * SMix 下界 `128·N·r` = **32 MiB**，而 `N=2^13` 只有 8 MiB（算式，不是读数）；
 * 上表也印证了这一点（独立进程 RSS 增量 +37 MiB vs +13 MiB）。
 * 攻击方要并行爆破就得按次预留这份内存。OWASP 把五档列为同等防护，所以这是取舍不是对错；
 * 若将来需要降低函数内存峰值，`2^13/p=10` 是有据可选的降档，不是「更弱的草率选项」。
 *
 * ## 五档实测（跑本文件实现，不是另写的模拟代码）
 *
 * 同机：Apple M1 Pro / 8 逻辑核 / Node v26.10.0 / macOS。测法是**导入本模块**、
 * 每档起一个独立进程、进程内跑三轮取**中位数**。「最坏兑换」= 一个错误明文 ×
 * 10 行候选 = 10 次串行派生比对，即真实最坏路径；内存列是算式而非读数。
 *
 * | N | p | SMix 下界 `128·N·r` | 10 次串行派生 | 最坏兑换 | 10 张并发派生 |
 * |---|---|---|---|---|---|
 * | 2^17 | 1 | 128 MiB | 2767ms | 2768ms | 843ms |
 * | 2^16 | 2 | 64 MiB | 2715ms | 2724ms | 845ms |
 * | **2^15** | **3** | **32 MiB** | **2007ms** | **1991ms** | **626ms** |
 * | 2^14 | 5 | 16 MiB | 1625ms | 1626ms | 516ms |
 * | 2^13 | 10 | 8 MiB | 1598ms | 1587ms | 498ms |
 *
 * 表内每格是同进程三轮的中位数，三轮极差最大 50ms（`2^17` 的最坏兑换 2768/2723/2818），
 * 而表内相邻两档差 100–380ms ⇒ 排序是真实的，不是噪声。单次派生三次独立进程读数
 * 205 / 208 / 209ms（中位 208），单次验证 201 / 202 / 207ms（中位 202），
 * 进程 RSS 增量稳定在 +36~37 MiB。
 * **并发生成的墙钟远不是线性的**：本档并发三轮中位 626ms，相对单次 208ms 的加速比
 * 只有约 3.3×（不是 10×）；另一组独立读数 759ms 给出 2.8×。把 `UV_THREADPOOL_SIZE`
 * 显式提到 16 后同一脚本降到 480ms（4.4×）⇒ 瓶颈是 libuv 默认 4 线程，不是 CPU。
 * 所以别把「并发 = 免费」当默认假设。
 *
 * **两条路径形状不同，成本要分开说**：
 *   - 兑换（`redeemRecoveryCode`）：盐和参数记在每一行里，所以**不能**先哈希一次明文再去比，
 *     必须逐张派生。最坏 ≈ 2 秒（10 张全不中或中最后一张）。
 *     接受它的理由有两条硬的：恢复码只在验证器丢了之后用（低频），
 *     候选数由 `RECOVERY_CODE_COUNT` 钉住（不是无界循环），而且兑换前置要求已有
 *     合法会话（`supabase.auth.getUser()`，未登录直接 `notAuthenticated`）。
 *     **第三条以前写成「接口有 IP 限流兜着」，那句话比实情强**，现在照实说：
 *     兑换确实调了 `checkActionRateLimit()`（`RATE_LIMIT` 100 次/分钟），但这个桶
 *     ① 与 `account` / `audit` / `contact` 三个 action **共享**，不是为这条路径配的；
 *     ② key 取 `x-real-ip`，缺失时退到 `x-forwarded-for` 的**最左段**——`rate-limit.ts`
 *        自己的注释就写明「任何人都能用 `X-Forwarded-For: 1.2.3.4` 换一个桶」；
 *     ③ 是**进程内内存**滑窗，serverless 下每个 isolate 各一份。
 *     所以它能挡住随手刷，挡不住「拿几个伪造来源地址轮着刷」的定向 CPU/成本消耗
 *     （每次兑换最坏付 10 次 scrypt ≈ 2 秒，libuv 线程池默认 4 ⇒ 4 个并发请求就能打满）。
 *     这里**不把它写成安全边界**；真要收口，正确做法是给兑换单独加一把
 *     **按用户**的冷却（而不是把这句注释改得更乐观）。
 *   - 生成（`generateRecoveryCodes`）：保留 `Promise.all` 并发（本档中位 626ms /
 *     独立进程 RSS 峰值增量 +134 MiB）。串行会更慢（2007ms）而没有任何收益。
 *     **将来要调 `RECOVERY_CODE_COUNT` 时，重测的是这一条**——它同时受候选数与线程池约束。
 * 若兑换路径将来变热，正确做法不是调低参数，而是把盐提成可索引的列、
 * 先按 `(user_id, salt)` 缩小候选集。
 *
 * 存量兼容：旧行是 64 位十六进制的裸 SHA-256，没有版本前缀也没有盐。校验时按形状分派，
 * 所以**不需要迁移**（`code_hash` 是 `text`）；旧码仍可用，但只在新码生成时被整体替换
 * （`replaceRecoveryCodes` 先 delete 再 insert），因此这个弱分支会随用户重新生成而消失。
 *
 * node:crypto 必须动态导入：本模块经 `actions/recovery-codes.ts`（`"use server"`）
 * 被客户端组件引用，顶层静态导入会破坏 Turbopack 客户端代理的导出分析。
 */

/** 新格式的算法标识（也是「这不是裸 SHA-256」的判据）。 */
const SCRYPT_PREFIX = "scrypt";

/** 裸 SHA-256 的十六进制长度：存量行的唯一可识别形状。 */
const LEGACY_SHA256_HEX_LENGTH = 64;

/** 派生输出长度（字节） */
const KEY_LENGTH = 32;

/** 随机盐长度（字节） */
const SALT_BYTES = 16;

/** 默认 scrypt 参数：N=2^15 / r=8 / p=3（OWASP 最低等价档之一）。 */
export const RECOVERY_CODE_KDF = {
  algorithm: SCRYPT_PREFIX,
  n: 1 << 15,
  r: 8,
  p: 3,
  keyLength: KEY_LENGTH,
  saltBytes: SALT_BYTES,
} as const;

/** 测试用的低成本参数：只验证语义，不承担真实防护。 */
export const TEST_KDF = {
  algorithm: SCRYPT_PREFIX,
  n: 1 << 10,
  r: 1,
  p: 1,
  keyLength: KEY_LENGTH,
  saltBytes: SALT_BYTES,
} as const;

/** scrypt 参数（可覆盖以便用例跑低成本配置）。 */
export interface RecoveryCodeKdfParams {
  n: number;
  r: number;
  p: number;
  keyLength: number;
  saltBytes: number;
}

/**
 * 一张已存恢复码的可解析形态。
 *
 * `legacySha256` 显式建模而不是「另一种字符串」：它的盐恒为空、比较时不做派生，
 * 把它塞进统一分支会让「有盐」这个前提在读代码时看不出来。
 */
export type StoredRecoveryCodeHash =
  | { kind: "scrypt"; n: number; r: number; p: number; saltHex: string; derivedHex: string }
  | { kind: "legacySha256"; derivedHex: string };

/** 归一化明文：去掉展示用的连分组（`XXXX-XXXX` → `XXXXXXXX`）。 */
function normalizeForHash(code: string): string {
  return code.replace(/-/g, "");
}

function isHex(value: string): boolean {
  return value.length > 0 && value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value);
}

/**
 * 派生一张恢复码的新格式哈希：`scrypt$N$r$p$saltHex$derivedHex`。
 *
 * 每次调用取新的随机盐，所以同一个明文两次生成的结果不同——这是刻意的，
 * 它同时破坏了「跨用户比对同一张码」和「一张 crack 全库」两条离线捷径。
 */
export async function deriveRecoveryCodeHash(
  code: string,
  params: RecoveryCodeKdfParams = RECOVERY_CODE_KDF,
): Promise<string> {
  const { randomBytes } = await import("node:crypto");
  const salt = randomBytes(params.saltBytes);
  const derived = await runScrypt(normalizeForHash(code), salt, params);
  return [
    SCRYPT_PREFIX,
    params.n,
    params.r,
    params.p,
    salt.toString("hex"),
    derived.toString("hex"),
  ].join("$");
}

async function runScrypt(
  password: string,
  salt: Buffer,
  params: Pick<RecoveryCodeKdfParams, "n" | "r" | "p" | "keyLength">,
): Promise<Buffer> {
  const { scrypt } = await import("node:crypto");
  return new Promise((resolve, reject) => {
    // maxmem 必须显式给。本档的**实测**下限是 33,559,552 字节（二分搜索得到），
    // 比 Node 默认上限 32 MiB（33,554,432 字节）多 **5120 字节**；不带 maxmem 直接失败。
    // 下限的闭合式在三个参数组上都对得上：`128·r·(N+p) + 2048`
    // （2^15/p=3 → 33,557,504+2,048；2^13/p=10 → 8,398,848+2,048；2^17/p=1 → 134,218,752+2,048）。
    // 上一版这里把下界写成 `128·r·(N+p)` 并说「比默认上限多 3072 字节」——那个 3072
    // 是拿两个数相减凑的（33,557,504 − 33,554,432），少了 OpenSSL 的 2048 字节固定开销，
    // 而且实测证明**贴 `128·r·(N+p)` 这个值本身就失败**（见上表三档：都要再加 2048 才过）。
    // 结论（不带 maxmem 会失败）没错，口径是错的。
    // 注意失败是**同步抛出** `RangeError`（不是回调里的 error），所以它落在这里的
    // Promise executor 里、由 executor 转成 rejection；下面的 try/catch 因此必须留着。
    // 取 2 倍余量而不是贴着下限：贴下限的写法对 2048 这个常数的来源没有把握，
    // 一旦 OpenSSL 改了开销就变成生产里的随机失败。
    const maxmem = Math.max(128 * params.r * (params.n + params.p) * 2, 64 << 20);
    scrypt(
      password,
      salt,
      params.keyLength,
      { N: params.n, r: params.r, p: params.p, maxmem },
      (error, derived) => (error ? reject(error) : resolve(derived)),
    );
  });
}

/** 存量形状：64 位十六进制的裸 SHA-256。 */
function parseLegacyHash(stored: string): StoredRecoveryCodeHash | null {
  if (stored.length !== LEGACY_SHA256_HEX_LENGTH || !isHex(stored)) return null;
  return { kind: "legacySha256", derivedHex: stored.toLowerCase() };
}

/** `scrypt$N$r$p$saltHex$derivedHex`：参数不合法就地判否，不留给 scrypt 报错。 */
function parseScryptHash(stored: string): StoredRecoveryCodeHash | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== SCRYPT_PREFIX) return null;
  const [, nRaw, rRaw, pRaw, saltHex, derivedHex] = parts;
  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  // N 必须是 2 的幂且 ≥2；r/p 必须是正整数。放过去会让「存储内容决定异常路径」，
  // 而那正是本函数要挡住的东西。
  if (!Number.isInteger(n) || n < 2 || (n & (n - 1)) !== 0) return null;
  if (!Number.isInteger(r) || r < 1) return null;
  if (!Number.isInteger(p) || p < 1) return null;
  if (!isHex(saltHex) || !isHex(derivedHex)) return null;
  return {
    kind: "scrypt",
    n,
    r,
    p,
    saltHex: saltHex.toLowerCase(),
    derivedHex: derivedHex.toLowerCase(),
  };
}

/**
 * 解析库里的 `code_hash`。读不出形状就返回 `null`（调用方按「不匹配」处理，
 * 绝不回退成裸比较——一个被截断或注入过的前缀字段不该参与认证）。
 */
export function parseStoredRecoveryCodeHash(stored: string): StoredRecoveryCodeHash | null {
  if (typeof stored !== "string" || stored.length === 0) return null;
  return stored.startsWith(`${SCRYPT_PREFIX}$`)
    ? parseScryptHash(stored)
    : parseLegacyHash(stored);
}

/** 常量时间比较两段十六进制；长度不同直接判否（与旧实现一致）。 */
async function timingSafeHexEqual(aHex: string, bHex: string): Promise<boolean> {
  const { timingSafeEqual } = await import("node:crypto");
  const a = Buffer.from(aHex, "hex");
  const b = Buffer.from(bHex, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 旧格式：对明文重算未加盐的 SHA-256（只为让存量码继续能用）。 */
async function legacySha256Hex(code: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(normalizeForHash(code)).digest("hex");
}

/**
 * 判断一张明文码是否匹配库里存的哈希，按存储形状分派。
 *
 * `params` 只在派生新格式时用于**覆盖内存里的默认值**这一点上生效；存量行的参数写在
 * 字符串里，所以校验用的是那一行自己记录的 N/r/p。这样默认参数以后调整时，
 * 已生成的码仍然可验证（否则会把自己用户锁在门外）。
 */
export async function verifyRecoveryCodeHash(
  code: string,
  stored: string,
  params: RecoveryCodeKdfParams = RECOVERY_CODE_KDF,
): Promise<boolean> {
  const parsed = parseStoredRecoveryCodeHash(stored);
  if (!parsed) return false;

  if (parsed.kind === "legacySha256") {
    return timingSafeHexEqual(await legacySha256Hex(code), parsed.derivedHex);
  }

  let derived: Buffer;
  try {
    derived = await runScrypt(normalizeForHash(code), Buffer.from(parsed.saltHex, "hex"), {
      n: parsed.n,
      r: parsed.r,
      p: parsed.p,
      keyLength: parsed.derivedHex.length / 2,
    });
  } catch {
    // 参数合法到能解析、却非法到 scrypt 直接报错（例如 p 超出实现上限）。
    // 在认证路径上「验不出来」必须等于「不匹配」而不是抛：调用方是恢复码兑换，
    // 抛错会让一次普通的输错变成 500，而失败封闭的方向只有一个——拒绝。
    return false;
  }
  return timingSafeHexEqual(derived.toString("hex"), parsed.derivedHex);
}

/** 供用例与文档断言：这张存储行是不是仍走 SHA-256 那条弱路径。 */
export function isLegacyRecoveryCodeHash(stored: string): boolean {
  return parseStoredRecoveryCodeHash(stored)?.kind === "legacySha256";
}
