/**
 * 待发队列读数的组装（v0.12.0 A05 前半的服务端一侧）。
 *
 * 单独成模块有两个原因：① `Date.now()` 必须有一个非组件宿主——放在 Server Component 里
 * 会被 `react-hooks/purity` 拦下，而把时钟塞进模块顶层又会让年龄从进程启动起就不动；
 * ② 面板要的从来不是几段查询，而是「同一口径下的几个读数」，所以拼装只有一处。
 * 规则本体在 `queue-diagnostics.ts`（纯函数，不碰 Supabase 也不读时钟）。
 */
import {
  countEmailSkippedByReason,
  countReadBeforeSendEmailNotifications,
  countUnsentEmailNotifications,
  oldestUnsentEmailCreatedAt,
} from "@/lib/repositories/notifications";
import { listRecentEmailWorkerRuns } from "@/lib/repositories/worker-runs";
import { deriveQueueDiagnostics, type QueueDiagnostics } from "./queue-diagnostics";

export async function readEmailQueueDiagnostics(): Promise<QueueDiagnostics> {
  const [pending, oldestCreatedAt, recentRuns, skippedByReason, readBeforeSend] =
    await Promise.all([
      countUnsentEmailNotifications(),
      oldestUnsentEmailCreatedAt(),
      listRecentEmailWorkerRuns(),
      // A05：两笔「已经离开队列」的账。一笔是 worker 当场判定寄不出去（写了原因），
      // 一笔是用户在站内先读掉了（队列条件含 `is_read=false`）。后者不经任何指标，
      // 只看 `pending` 会把「越堵」读成「越小」，所以它必须和积压数同批取。
      countEmailSkippedByReason(),
      countReadBeforeSendEmailNotifications(),
    ]);
  return deriveQueueDiagnostics({
    pending,
    oldestCreatedAt,
    recentRuns,
    skippedByReason,
    readBeforeSend,
    nowMs: Date.now(),
  });
}
