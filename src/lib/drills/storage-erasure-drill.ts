/**
 * 「app 自己的擦除链路能不能真删掉 bucket 里的字节」的判定层（纯函数，由 Vitest 覆盖）。
 *
 * 起因（2026-10-25）：B03 的「仍未取得的生产证据」列着三项，其中
 * **真实 bucket 对象删除**这一项，此前两份本地证据都覆盖不到它：
 *   - `docs/operations/drills/*.single-do.sql` 只动数据库（`upload_objects` 元数据行），
 *     它连的是 SQL，**碰不到 storage provider**；
 *   - `pnpm smoke:supabase-identity` 的 13 项 storage 检查（本轮实跑 20/20 全绿）
 *     验的是**原始 REST + RLS 策略**——它自己发 HTTP，**不经过 `src/lib/storage` 那层驱动**。
 *   ⇒ 「我们的代码删得掉对象吗」这一格，两份证据都没答，而它长得像已经答过了。
 *     这正是本仓库反复说的「**看起来像被检查过**」比没检查更糟。
 *
 * 本模块补的是这一格，判据走**应用真实调用路径**
 * （`getStorageDriver().put/remove`，即擦除链路 `cleanupStorageObject` 用的同一层）。
 *
 * ## 承重的是这道闸：`assertLocalOnlyTarget`
 *
 * 本机 `.env.local` 里的 `NEXT_PUBLIC_SUPABASE_URL` 指向**生产项目**（本轮实测确认）。
 * 一个会往 bucket 写对象、再从 bucket 删对象的探测，
 * 如果默认继承环境里的 URL，就是一次**默认打生产**的写操作——
 * 与 B04 的「保护生产的是审批而不是能力」是同一件事的反面：
 * 这里没有审批可等，所以把「只准打本地」写死成**失败关闭的闸**，
 * 让「手滑删了生产对象」在结构上不可能发生，而不是靠运行的人记得。
 */

/** 允许写操作的宿主：只有本机。刻意不放进任何「看起来像本地」的别名以外的口子。 */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export interface TargetGuard {
  ok: boolean;
  reason: string;
  host: string;
}

/**
 * 判一个基址能不能作为写目标的本地栈。
 *
 * 解析不出来 ⇒ **拒绝**（不是放行）：一个读不懂的地址不能因为「看不懂」就当它安全。
 * https 也不放行——本地栈就是 http，允许 https 只会给「误配成生产」留一条通道。
 */
export function assertLocalOnlyTarget(rawUrl: string | undefined): TargetGuard {
  const value = (rawUrl ?? "").trim();
  if (value.length === 0) {
    return { ok: false, reason: "没有给基址——本探测要求显式 --url，不继承 process.env", host: "" };
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: `基址解析不出来：${value.slice(0, 60)}——解析不了就拒绝`, host: "" };
  }
  const host = parsed.hostname;
  if (parsed.protocol !== "http:") {
    return {
      ok: false,
      reason: `只允许 http:，实际是 ${parsed.protocol}（本地栈是 http；放行 https 等于给生产留通道）`,
      host,
    };
  }
  if (!LOCAL_HOSTS.has(host)) {
    return {
      ok: false,
      reason: `宿主不是本机：${host}——本探测会真写 bucket，只准打本地栈`,
      host,
    };
  }
  return { ok: true, reason: `本机栈 ${host}`, host };
}

export type StorageErasureStep =
  | "SKIPPED_GUARD"
  | "SKIPPED_CAPABILITY"
  | "PASSED"
  | "FAILED_PUT"
  | "FAILED_VISIBLE"
  | "FAILED_REMOVE"
  | "FAILED_STILL_PRESENT";

export interface StorageErasureReport {
  step: StorageErasureStep;
  evidence: string;
  provider: string;
}

interface Readings {
  putOk: boolean;
  visibleOk: boolean;
  removeOk: boolean;
  goneAfterRemove: boolean;
}

/**
 * 组装报告。顺序即判据：**put → 可读 → 删 → 删后不可读**。
 *
 * 「删后还能读到」是最坏的一种，单独成档（`FAILED_STILL_PRESENT`）而不是混进删除失败：
 * `remove` 回 200 但对象还在，意味着擦除链路**静默没生效**——
 * 用户删了号，图片还挂在 bucket 里，而代码路径报告成功。
 * 这比抛错的删除危险，因为没有任何信号会去找它。
 */
export function judgeStorageErasure(input: {
  guard: TargetGuard;
  provider: string;
  supportsRemove: boolean;
  readings: Readings | null;
}): StorageErasureReport {
  const { guard, provider, supportsRemove, readings } = input;
  if (!guard.ok) {
    return { step: "SKIPPED_GUARD", provider, evidence: `目标闸拦下：${guard.reason}（未发出任何写请求）` };
  }
  if (!supportsRemove) {
    return { step: "SKIPPED_CAPABILITY", provider, evidence: `驱动 ${provider} 不声明 remove 能力，无从验证` };
  }
  if (readings === null) {
    return { step: "FAILED_PUT", provider, evidence: "读数缺失——没建成探针对象，后续步骤未执行" };
  }
  if (!readings.putOk) {
    return { step: "FAILED_PUT", provider, evidence: "探针对象上传失败：驱动的连接/权限形状本身有问题" };
  }
  if (!readings.visibleOk) {
    return { step: "FAILED_VISIBLE", provider, evidence: "对象建好了却读不到——公共读形状与预期不符，删除判据无从建立" };
  }
  if (!readings.removeOk) {
    return { step: "FAILED_REMOVE", provider, evidence: "remove 调用失败（抛错或非 2xx）" };
  }
  if (!readings.goneAfterRemove) {
    return {
      step: "FAILED_STILL_PRESENT",
      provider,
      evidence:
        "**remove 报告成功但对象仍可读** ⇒ 擦除链路静默失效：账户删了、字节还在 bucket 里，而代码路径说成功了",
    };
  }
  return { step: "PASSED", provider, evidence: "建对象 → 公共读可见 → 经应用驱动 remove → 删后不可读，四步全过" };
}

/** PASSED 才算通过；闸拦下与能力缺失算「未验证」（2），其余是坏结论（1）。 */
export function exitCodeForStorageErasure(step: StorageErasureStep): number {
  if (step === "PASSED") return 0;
  if (step === "SKIPPED_GUARD" || step === "SKIPPED_CAPABILITY") return 2;
  return 1;
}
