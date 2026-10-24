/**
 * 「SQL 演练里的 `delete from auth.users`」与「真 `auth.admin.deleteUser`」
 * 在本地栈上的可观察行为是否等价——判定层（纯函数，由 Vitest 覆盖）。
 *
 * 起因（2026-10-25）：B03 的登记写着
 * 「演练里用 `delete from auth.users` 等价替代，**级联语义相同但没走 GoTrue 的会话清理**」，
 * 而 `auth.admin.deleteUser` 不可逆、要隔离账号，于是这条被归进「缺外部权限」。
 * 但**那句「没走会话清理」从来没有被验证过**——它是一个未经测试的担心，
 * 却被写成了登记事实，并且正在阻塞 v0.12.0 的 tag 前置。
 *
 * 本地栈有真 GoTrue，所以这件事本可以在本地答。实测结论：两种删法的
 * **可观察行为逐项相同**（auth 侧残留都是 0；旧 refresh_token 都回 400
 * `refresh_token_not_found`；旧 access_token 打 `/user` 都回 403）
 * ⇒ 那句担心在本机 GoTrue v2.195.0 上**不成立**。
 *
 * 两条分寸，本模块用 verdict 形状强制它们不被混读：
 *   1. **版本不同就不许说「生产也这样」**：生产 GoTrue 是 v2.197.0（当日只读实测），
 *      与本地 v2.195.0 差两个 patch 版。所以本探测的结论档位里，
 *      「等价」与「可迁移到生产」是两个不同的判断（`VERSION_SKEW`）。
 *   2. **读不到就说不读**：任一侧读数缺失 ⇒ `UNVERIFIABLE`，由调用方以退出码 2 收场，
 *      绝不压成「等价」（与 `migration-status.ts` 的「未知不算通过」同族）。
 *
 * 与 `preflight.ts` 的关系：preflight 判的是「能不能跑演练」，
 * 本模块判的是「那个等价替代到底等不等价」。两者都是判定层，都不碰网络。
 */

/** 一次删除后可观察行为的读数。 */
export interface DeletionProbeResult {
  /** auth 侧按 user_id 计的残留（sessions / refresh_tokens / identities / …）。 */
  residue: Record<string, string>;
  /** 删号后用旧 refresh_token 刷新的 HTTP 状态。 */
  refreshStatus: number;
  /** 删号后用旧 access_token 打 `/user` 的 HTTP 状态。 */
  accessStatus: number;
  /** 该侧 GoTrue 版本（`/auth/v1/health` 的 `version`）。 */
  gotrueVersion: string;
}

export type AuthDeletionEquivalenceVerdict =
  /** 两种删法的可观察行为逐项相同，且版本一致 ⇒ 结论可迁移。 */
  | "EQUIVALENT"
  /** 行为相同但本地与生产版本不同 ⇒ 只在本地成立，不自动适用于生产。 */
  | "EQUIVALENT_LOCAL_ONLY"
  /** 行为有差异 ⇒ 等价替代不成立，演练结论需要重写。 */
  | "DIFFERS"
  /** 读不到某个变体 ⇒ 此刻不构成任何证据。 */
  | "UNVERIFIABLE";

export interface AuthDeletionEquivalenceReport {
  verdict: AuthDeletionEquivalenceVerdict;
  evidence: string;
  /** 差异项（verdict 为 DIFFERS 时非空，便于人直接定位）。 */
  differences: string[];
}

/** 残留读数的键必须排序后逐项比，否则「顺序不同」会被读成「内容不同」。 */
function compareResidue(left: Record<string, string>, right: Record<string, string>): string[] {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const differences: string[] = [];
  for (const key of keys) {
    if (left[key] !== right[key]) differences.push(`${key}: ${left[key] ?? "缺失"} vs ${right[key] ?? "缺失"}`);
  }
  return differences;
}

/** 版本号是否可直接比较（都是 `vX.Y.Z` 形态）。 */
function comparableVersion(value: string): string | null {
  return /^v?\d+\.\d+\.\d+$/.test(value.trim()) ? value.trim().replace(/^v/, "") : null;
}

/**
 * 判「SQL 删除」与「真 deleteUser」是否等价。
 *
 * `sql` / `admin` 任一为 null（那个变体没跑成、或读数读不到）⇒ `UNVERIFIABLE`：
 * 把「没测到」说成「相同」是这条探测最坏的失败方式。
 */
export function judgeAuthDeletionEquivalence(
  sql: DeletionProbeResult | null,
  admin: DeletionProbeResult | null,
  productionGoTrueVersion?: string,
): AuthDeletionEquivalenceReport {
  if (sql === null || admin === null) {
    return {
      verdict: "UNVERIFIABLE",
      differences: [],
      evidence: "至少一侧的读数没取到——不构成证据，不能据此说「等价」也不能说「不等价」",
    };
  }

  const differences = compareResidue(sql.residue, admin.residue);
  if (sql.refreshStatus !== admin.refreshStatus) {
    differences.push(`refresh_token: HTTP ${sql.refreshStatus} vs HTTP ${admin.refreshStatus}`);
  }
  if (sql.accessStatus !== admin.accessStatus) {
    differences.push(`access_token(/user): HTTP ${sql.accessStatus} vs HTTP ${admin.accessStatus}`);
  }

  if (differences.length > 0) {
    return {
      verdict: "DIFFERS",
      differences,
      evidence: `可观察行为有 ${differences.length} 处差异：${differences.join(" / ")}`,
    };
  }

  const localVersion = comparableVersion(sql.gotrueVersion);
  const adminVersion = comparableVersion(admin.gotrueVersion);
  const sameLocalVersions = localVersion !== null && localVersion === adminVersion;
  const productionVersion = comparableVersion(productionGoTrueVersion ?? "");

  if (!sameLocalVersions) {
    return {
      verdict: "UNVERIFIABLE",
      differences: [],
      evidence:
        `两个变体打到的 GoTrue 版本不一致（${sql.gotrueVersion} / ${admin.gotrueVersion}）——` +
        "同一轮实验里两侧必须同版本，否则「相同」可能是版本差造成的假象",
    };
  }

  const shared = `残留、旧 refresh_token（HTTP ${admin.refreshStatus}）与旧 access_token（HTTP ${admin.accessStatus}）逐项相同`;
  if (productionVersion === null) {
    return {
      verdict: "EQUIVALENT_LOCAL_ONLY",
      differences: [],
      evidence: `${shared}；但**没有生产 GoTrue 版本读数**，所以这条结论只在本地成立（本地 ${sql.gotrueVersion}）`,
    };
  }
  if (productionVersion !== localVersion) {
    return {
      verdict: "EQUIVALENT_LOCAL_ONLY",
      differences: [],
      evidence:
        `${shared}；本地 GoTrue ${sql.gotrueVersion} 与生产 ${productionGoTrueVersion} **不同版** ⇒ ` +
        "不能自动迁移到生产，要判生产得在生产侧重跑",
    };
  }
  return {
    verdict: "EQUIVALENT",
    differences: [],
    evidence: `${shared}，且本地与生产同为 ${sql.gotrueVersion}`,
  };
}

/** verdict → 退出码。等价（含只在本地成立）都是 0：探测答的是「本地证据」。 */
export function exitCodeForEquivalence(verdict: AuthDeletionEquivalenceVerdict): number {
  if (verdict === "UNVERIFIABLE") return 2;
  return verdict === "DIFFERS" ? 1 : 0;
}
