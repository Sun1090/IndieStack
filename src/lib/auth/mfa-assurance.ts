/**
 * MFA（第二步验证）的**服务端**闸门。
 *
 * ## 为什么要有这一条
 *
 * 在此之前，2FA 在这套代码里是一句 **UI 约定**：登录表单读到 `user.factors` 里有已验证因子
 * 就 `router.push("/auth/mfa")`，剩下的靠用户自己走过去。服务端**一处都没有**检查过
 * `aal`（`grep -rn "getAuthenticatorAssuranceLevel\|aal2" src/` 当时为 0 命中），
 * 于是密码登录拿到的 aal1 会话在 RLS 眼里与 aal2 完全等价：
 * 拿到密码的人关掉 JS、直接 `GET /dashboard`，就能读到全部仪表盘数据——
 * 而真正拦他的只有一句「前端会跳转」。
 *
 * 同一处还有一个反向缺陷：`/auth/mfa` 原本在 `proxy.ts` 的 `authRoutes` 里，
 * 那段逻辑是「已登录 ⇒ 弹回 /dashboard」，于是连**愿意**输入验证码的人也进不了挑战页。
 * 两件事合起来的效果是「2FA 既不强制、也无法完成」。
 *
 * ## 判定口径
 *
 * 只认 Supabase 自己的两个读数：
 * - `nextLevel === "aal2"` ⇒ **这个账号**有已验证因子，登录后应当停在 aal1 等第二步；
 * - `currentLevel !== "aal2"` ⇒ 第二步**还没做**。
 *
 * 两条同时成立才拦。没有因子（`nextLevel` 仍是 aal1）的用户一条都不会被影响——
 * 这是「开了 2FA 才多一步」的正确方向，也是不能把它写成「所有人必须 aal2」的原因。
 *
 * ## 读不到时为什么是 503 而不是放行
 *
 * `getAuthenticatorAssuranceLevel` 失败时**不能当作「不需要第二步」**：那正是这套控制
 * 最贵的失效方式（读不到 ⇒ 放行 ⇒ 2FA 在 Auth 抖动时静默失效，而且没有任何读数）。
 * 与 `requireAuth` 对「会话读不出来」的处理一致：抛 `SERVICE_UNAVAILABLE`，
 * 由仪表盘的 `error.tsx` 给出可重试的错误页。差别是这里**不会**把人登出，
 * 所以重试一次就恢复了。
 */
import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import { SERVICE_UNAVAILABLE } from "./guards";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** `getAuthenticatorAssuranceLevel()` 的读数形状（只取判据用到的那两项）。 */
export interface AssuranceLevelReading {
  currentLevel: string | null;
  nextLevel: string | null;
}

/**
 * 纯判定：这一轮是否必须先完成第二步验证。
 *
 * 单独抽出来是为了能被穷举（真判定里夹着一次网络调用与一次 redirect，
 * 那种函数只能测「有没有被调用」）。四条边界：没读数、只有 nextLevel、
 * 已完成 aal2、以及「当前反而比 next 高」（理论上不该出现，但此时不该拦）。
 */
export function requiresMfaStepUp(reading: AssuranceLevelReading | null | undefined): boolean {
  if (!reading) return false;
  return reading.nextLevel === "aal2" && reading.currentLevel !== "aal2";
}

/**
 * 服务端闸门：需要第二步时重定向到挑战页，并**带上因子 id**。
 *
 * 为什么要带 `factor`：挑战页没有它时只会显示「缺少参数，请重新登录」——
 * 那是给「有人手工敲 URL」准备的兜底，不该成为**服务端自己**把人送过去时的落点。
 * 因子在这里多读一次（`listFactors`）只发生在真的需要第二步的那一刻，不在热路径上。
 */
export async function requireMfaAssurance(
  supabase: Supabase,
  nextPath: string = ROUTES.dashboard,
): Promise<void> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) {
    throw SERVICE_UNAVAILABLE;
  }
  if (!requiresMfaStepUp(data)) return;

  // 读不到因子就让挑战页走它自己的兜底：**不要**在这里编一个 id 出来。
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verified = factors?.totp?.find(
    (factor: { id: string; status: string }) => factor.status === "verified",
  );

  const params = new URLSearchParams({ redirect: nextPath });
  if (verified?.id) params.set("factor", verified.id);
  redirect(`${ROUTES.mfa}?${params.toString()}`);
}
