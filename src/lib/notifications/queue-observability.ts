/**
 * 待发队列读数的组装（v0.12.0 A05 前半的服务端一侧）。
 *
 * 单独成模块有两个原因：① `Date.now()` 必须有一个非组件宿主——放在 Server Component 里
 * 会被 `react-hooks/purity` 拦下，而把时钟塞进模块顶层又会让年龄从进程启动起就不动；
 * ② 面板要的从来不是三段查询，而是「同一口径下的三个读数」，所以拼装只有一处。
 * 规则本体在 `queue-diagnostics.ts`（纯函数，不碰 Supabase 也不读时钟）。
 */
import {
  countUnsentEmailNotifications,
  oldestUnsentEmailCreatedAt,
} from "@/lib/repositories/notifications";
import { listRecentEmailWorkerRuns } from "@/lib/repositories/worker-runs";
import { deriveQueueDiagnostics, type QueueDiagnostics } from "./queue-diagnostics";

export async function readEmailQueueDiagnostics(): Promise<QueueDiagnostics> {
  const [pending, oldestCreatedAt, recentRuns] = await Promise.all([
    countUnsentEmailNotifications(),
    oldestUnsentEmailCreatedAt(),
    listRecentEmailWorkerRuns(),
  ]);
  return deriveQueueDiagnostics({ pending, oldestCreatedAt, recentRuns, nowMs: Date.now() });
}
