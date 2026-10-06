/**
 * 外部依赖实况（只读诊断）。
 *
 * GET /api/ops/provider-status
 * Header: authorization: Bearer <CRON_SECRET> 或 x-cron-secret: <CRON_SECRET>
 *
 * ## 为什么要有这个端点
 *
 * `docs/operations/environments.md` 有一张「外部依赖实况」表，规则是
 * **任何关于外部状态的结论都必须落在那张表里，并带观测命令与日期**。
 * 这条规则立刻带来一个难题：那张表里仍有 `❓ 未知` 行——
 * 典型是「生产到底配没配 `RESEND_API_KEY`」，答案是**从外面查不到**：
 * provider 诊断逻辑（`src/lib/providers/diagnostics.ts` 的 `diagnoseProviders`）
 * 写得完整、有单测，却**没有任何生产代码调用它**；
 * `/api/health` 只回 supabase / sentry / stripe 三项，且**有意**不回其余依赖；
 * 于是「邮件链路在生产上是不是空转的」这件事，只能靠翻 Vercel 环境变量页去猜。
 *
 * **一个必须靠猜才能回答的事实，就等于没有事实。** 这个端点把它变成一条命令。
 *
 * ## 鉴权与泄露面
 *
 * - 走 `isCronAuthorized`（与 `/api/ops/supabase-restore` 同一套），匿名 401。
 *   它返回的是**运维面**信息（哪些凭据配了、哪些没配），不是公开健康检查。
 * - **只回「键名缺没缺」，绝不回值**：`diagnoseProviders` 的 `ProviderDiagnostic.missing`
 *   按设计就只是变量名（该文件的注释写着 "Missing variable names only; values are never included"）。
 *   本端点不新增任何字段去碰 `process.env` 的值。
 * - 敏感度分级：`required=false` 的依赖缺失**不会**让响应变成失败——
 *   可选依赖没配是正常状态（这与 `/api/health` 的 `ready` 语义一致：
 *   `allConfigured=false` 而 `ready=true`）。
 *
 * 返回 `{ ok, mockMode, nodeEnv, providers, problems, warnings, checkedAt }`，
 * 结构与 `diagnoseProviders()` 的 `ProviderReport` 同构，只多了 `checkedAt`。
 */

import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { isCronAuthorized } from "@/lib/cron-auth";
import { diagnoseProviders } from "@/lib/providers/diagnostics";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers, process.env.CRON_SECRET)) {
    return jsonNoStore({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const report = diagnoseProviders();

  // **不要在这里加 `status: 503`。** 这个端点的职责是**报告**实况，
  // 而不是当依赖哨兵：可选依赖没配（比如生产没配 Stripe）是完全正常的发布形态，
  // 若因此返回非 2xx，运维脚本（与每日 cron）就会把它当成故障告警——
  // 那等于制造一个天天误报的信号位，而 `ok` 字段已经足够区分
  // 「必需依赖缺失」（`ok=false`）与「可选依赖缺失」（`ok=true` + `problems` 里只有 optional）。
  return jsonNoStore({
    ...report,
    checkedAt: new Date().toISOString(),
  });
}