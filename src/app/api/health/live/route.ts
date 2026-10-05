/**
 * 存活探针（liveness）——与 `/api/health` 的分工写在下面，两者不要合并。
 *
 * `/api/health` 是**就绪探针**：它打一次 Supabase（`limit(1)`），
 * 并在返回体里报告 Supabase / Sentry / Stripe 的配置与可达性、部署 commit、运行时长。
 * 这些对「发布后确认生产状态」是对的。
 *
 * 而 Docker HEALTHCHECK（`--interval=30s`）、负载均衡器、云编排的探针要的只是
 * **「这个进程还在吗」**。让它们走 readiness 会有两个代价：
 *  1. **放大面**：探针是唯一会被高频调用的公开端点，每次出站打一次数据库，
 *     等于给匿名调用者一个「用我的流量打你的数据库」的杠杆；
 *  2. **语义错位**：readiness 在依赖不可用时返回 503，
 *     而「进程活着但数据库暂时不可用」对存活探针来说**不是故障**——
 *     用 readiness 当 liveness，会让数据库抖动被误报成实例挂掉，并触发无谓的重启。
 *
 * 所以这一条**只答「活着」**：不打数据库、不读任何配置、不暴露部署身份。
 * 需要依赖明细与部署身份时用 `/api/health`（它保留 no-store 与既有响应契约，
 * `production-smoke` 与每日 cron 都读它）。
 *
 * 刻意**不返回 `version` / `commit`**：这一条是给机器看的，
 * 暴露精确 commit 等于告诉匿名调用者「该打哪个已知漏洞的版本」。
 * 要确认部署身份请用 `/api/health`，那条的披露面是有意为之且已被文档登记。
 */

import { jsonNoStore } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export async function GET() {
  return jsonNoStore(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, must-revalidate",
      },
    },
  );
}