# Provider 与 Incident 演练 Runbook

> 本文档是 **B05 的执行手册与结论落点**。B05 在 `docs/roadmap-0.12.0.md` 里长期挂着
> 「未完成：外部权限」，而它原来的结论落点写的是「各 provider runbook 的「执行记录」小节」——
> **那个小节当时并不存在**（`docs/operations/` 下没有 provider 专属 runbook）。
> 2026-10-05 把落点改到这里，并把这份 runbook 补上：结论写在下面的「执行记录」，
> 不要写在别处，否则这份文档又会和实际结论分家。
>
> 前置判定用 `pnpm drills:preflight --drill B05`。它只回答「还缺什么」，
> **不代表任何演练已通过**——这一点在代码、退出码与单测里都钉住了。

## 适用范围

覆盖三条必须打真实 provider 的演练（每条都要真发信 / 真推送 / 真停机）：

| 编号 | 演练                | 打什么                                     | 前置                                    |
| ---- | ------------------- | ------------------------------------------ | --------------------------------------- |
| P1   | Resend 缺失         | 不配 `RESEND_API_KEY` 时邮件队列的表现      | 无（可本地做，但结论只到「本地」）      |
| P2   | Resend 限流         | 真实 429 / 5xx 时的重试与死信              | `RESEND_API_KEY`（测试 key）            |
| P3   | Web Push VAPID 失效 | 失效订阅端点下的失败映射与队列推进          | `VAPID_PRIVATE_KEY` + `NEXT_PUBLIC_VAPID_PUBLIC_KEY` + 一个真实订阅端点 |
| P4   | Supabase 恢复链路   | 一次真实的恢复演练                          | `SUPABASE_ACCESS_TOKEN` + 可牺牲项目     |

不覆盖：密钥泄漏（见 `secrets-leak-response-runbook.md`）、依赖漏洞（Dependabot / `pnpm audit`）、
代码告警（见 `codeql-alert-triage.md`）。这几条各自已有归属，不要在这里重复一份。

## 先读这一段：哪些结论**不需要**真凭据

P1（Resend 缺失）在 mock 与本地构型下就能观察到队列行为，**不需要** API key。
把它列进来是为了说明一件事：**「缺凭据」和「没法验证」不是同一句话**。
P1 可以现在就做完并把结论写进下面的执行记录——**但只能写本地构型的结论**，
写成「生产已验证」就是撒谎。

其余三条都需要真实凭据，理由不是「流程要求」，而是**只有真实响应形状才能验到映射对不对**：

- P2：429 与 5xx 的响应体形状、header 与重试语义，在真 endpoint 上和 mock 上不一样。
- P3：`web-push` 固定走 `https.request`，**无法用环境变量把出站请求重定向到本地捕获端点**
  （见 `src/app/api/cron/push-retry/route.ts` 的注释）。所以失效订阅端点只能在真实 push service 上打。
  Mock 构型下只替换**传输层**（`src/lib/mock/push-transport.ts`），
  适配器本身的配置校验、载荷构造与错误映射保持真实——这正是它能证明的部分。
- P4：恢复演练要真的把项目停一次。

## 通用纪律

1. **先跑 `pnpm drills:preflight --drill B05`**。它报「齐了」只说明**可以跑**。
2. **结论必须带命令与时间**（UTC）。没有命令的结论不写进执行记录。
3. **区分「队列行为」与「投递成功」**。降级演练证明的是前者：
   邮件没寄出去但**留在队列里**、会重试，是正确行为；静默丢弃才是 bug。
4. **每次演练后检查积压指标**：邮件 `email.backlog`、推送 `push.backlog`
   （两者阈值都是 500，见 `src/lib/repositories/notifications.ts` 与
   `src/lib/repositories/push-delivery-attempts.ts`）。
   演练的常见副作用是自己造出一堆积压——**演练完必须确认它在回落**，否则测的是「制造故障」的能力。
5. **不要拿真实用户当演练对象**。需要账号时新建专用账号。

## P1 · Resend 缺失（不需要凭据，可立即执行）

**预期**：`src/lib/email-send.ts` 在 `RESEND_API_KEY` 缺失时抛 `RESEND_API_KEY missing`，
调用方决定重试 / 死信 / 吞错；**通知必须仍留在队列里**，不能因为发不出去就当作已发。

**命令**：

```bash
env -u RESEND_API_KEY pnpm dev
# 触发一次 digest（生产等价物是带 CRON_SECRET 打 /api/cron/digest），
# 然后查该通知在 notifications 表里的状态：应为「未发送 / 待重试」，不是「已发送」。
```

**判定**：队列里仍在 + 指标 `email.backlog` 上升 = 通过（降级正确）；通知被标记已发送 = **失败**。

## P2 · Resend 限流（需测试 key）

**预期**：真 endpoint 返回 429 / 5xx 时，失败进入重试而不是丢失；
`email.backlog` 上升但不丢条目。

**命令**：

```bash
pnpm drills:preflight --drill B05          # 确认 RESEND_API_KEY 存在
# 用 Resend 测试 key 对一个不存在的地址发信，观察 4xx 的真实响应体，
# 再用 webhooks 模拟或临时指向受限 key 观察 429。
```

**判定**：429 被映射为可重试 = 通过。**不要**为了制造 429 而真的狂发生产邮件。

## P3 · Web Push VAPID 失效（需 VAPID 一对 + 真实订阅端点）

**预期**：失效订阅（404/410）应被识别为「该端点永久失效」并清理，而不是无限重试。

**前置**：`src/lib/env.ts` 校验 `VAPID_PRIVATE_KEY` 与 `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
**必须同有同无**——只给一半时应用拒绝启动，所以本演练的前置是「一对」，不是「一个」。

**命令**：

```bash
pnpm drills:preflight --drill B05
# 换一个错误的 VAPID 私钥（与公钥不配对），重启后投递一次，观察错误映射与队列推进。
```

**判定**：失效订阅被清理、队列不被它堵住 = 通过。

## P4 · Supabase 恢复链路（需 `SUPABASE_ACCESS_TOKEN` + 可牺牲项目）

**预期**：`/api/ops/supabase-restore` 一次恢复循环能跑完并留下记录；
恢复后应用侧不出现「以为擦了其实没擦」的状态。

**命令**：

```bash
pnpm drills:preflight --drill B05
supabase migration list --linked      # 先确认连的是哪个项目——恢复演练不该对着生产跑
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<origin>/api/ops/supabase-restore
```

**判定**：恢复循环完成 + `pnpm smoke:production --expected-commit <SHA>` 仍然全绿 = 通过。
**恢复后必须重跑冒烟**：恢复是一次真实的状态变更，跑完不验等于没恢复。

## 执行记录

> 格式：UTC 时间 · 演练编号 · 命令 · 观测 · 判定（通过 / 失败 / 未执行及原因）。
> **未执行也要写**，并写清缺什么——否则下次重看时，「没记录」和「做过了」分不开。

| UTC 时间 | 编号 | 命令 | 观测 | 判定 |
| -------- | ---- | ---- | ---- | ---- |
| —        | P1   | —    | —    | 未执行（尚未进行；P1 不需要凭据，可直接执行） |
| —        | P2   | —    | —    | 未执行：缺 `RESEND_API_KEY` |
| —        | P3   | —    | —    | 未执行：缺 VAPID 一对与真实订阅端点 |
| —        | P4   | —    | —    | 未执行：缺 `SUPABASE_ACCESS_TOKEN` 与可牺牲项目 |

## 变更痕迹

- 2026-10-05：新建。此前 B05 的结论落点指向一个不存在的小节，
  由 `src/lib/drills/preflight.ts` 的「证据落点必须 `existsSync`」单测发现。