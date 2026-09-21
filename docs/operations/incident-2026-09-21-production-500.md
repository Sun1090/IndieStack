# 生产事故记录：全站动态路由 500（2026-09-21）

> 状态：**未解决，等待 Vercel 侧访问权限**。本文只记录已核实的事实与排除项，
> 不写未经证实的根因。

## 现象

`https://indie-stack.vercel.app` 上**所有动态路由**返回 Vercel 平台的 500：

```text
A server error has occurred
FUNCTION_INVOCATION_FAILED
hkg1::<request-id>
```

首次观测 2026-09-21T19:50Z 左右，至本文写作（约 20:15Z）持续，连续多次请求全部复现。

## 已核实的时间线

| 时间（UTC） | 事件 | 证据来源 |
|---|---|---|
| 08:52 | 定时保活探测**成功** | `health-check.yml` scheduled run |
| 10:09 | Supabase 兜底恢复轮次成功 | `supabase-auto-restore.yml` scheduled run |
| 17:33 | 手动 Production Smoke **成功**（生产仍返回 0.10.0 的健康 JSON） | `production-smoke.yml` run `35632786147` |
| 19:37 | PR #44 rebase 合并进 `main` | `git log` / CI runs |
| 19:50 | 全站动态路由 500 | 本次探测 |

## 排除项（都有实测依据）

- **不是本次合并把坏代码发到了生产**：`main` HEAD 的 Vercel 状态为
  `Deployment rate limited — retry in 24 hours.`（context `Vercel – indie-stack`，
  target 指向 build-rate-limit 升级页），即 19:37 的合并**没有产生部署**，生产仍是 0.10.0。
- **不是 Supabase 项目不可达**：`GET /auth/v1/health` → 200（`v2.197.0`），
  `GET /rest/v1/` → 401 `Secret API key required`（PostgREST 在正常校验凭据，不是网络/暂停）。
  本文档**不记录**任何 URL 之外的凭据信息。
- **不是整个 Vercel 账号被封或带宽耗尽**：静态资源 `favicon.ico` → 200，
  同账号的 `indie-stack-docs-site` 首页 → 200。
- **不是构建产物本身的问题（本地侧）**：同一份代码 `pnpm build` + `next start`
  在 `NODE_ENV=production` 下 `/api/health`、`/`、`/auth/login` 全部 200。

因此故障面限定在 **`indie-stack` 这一个 Vercel 项目的函数运行时**：静态文件正常、
函数每次调用都抛（`/` 这类页面也依赖运行时，因为语言/会话由 cookie 在请求期决定）。

## 需要的权限（阻塞项）

以下都是**只有项目所有者能做**的动作，自主代理无凭据：

1. Vercel Dashboard → `indie-stack` → Deployments（生产那一个）→ **Functions / Runtime Logs**，
   取 19:30Z 之后的第一条堆栈；
2. 确认该项目 19:30–19:50Z 之间是否改过 Environment Variables（缺一个必需变量会在函数启动时直接抛）；
3. 确认是否出现 usage cap / deployment paused 提示；
4. 若日志显示是配置漂移：补回变量即可恢复，**不需要**新部署；若是代码问题，
   由于构建配额受限（见 `release-runbook-v0.11.0.md` 的配额一节），需要等
   `retry in 24 hours` 窗口结束后重新部署，或由所有者手动触发一次部署。

## 对发布流程的影响

- **tag `v0.11.0` 继续推迟**：发布前置条件是生产健康且版本对齐，目前两者都不成立。
- 每日 `smoke-main` 漂移检查与 `health-check` 保活都会**持续失败**，这是预期信号，
  不要为了变绿而把 Supabase 降级为可选依赖或放宽断言。
- 保活链路本身此刻是失效的：它靠调用生产 `/api/health` 产生数据库活动，
  而该端点正在 500。若事故持续超过 Supabase 的闲置阈值，
  需要先恢复函数、再确认项目未被暂停（`supabase-auto-restore` 依赖
  `SUPABASE_ACCESS_TOKEN`，缺失时按 `action=skipped` 上报而不是静默）。

## 事后要补的证据

事故恢复后，把下面几项补进 `production-smoke-v0.11.0.md` 的证据矩阵，而不是只留一句「已恢复」：

- 恢复时刻与触发动作（改了什么 / 重新部署了哪个 commit）；
- 恢复后 `pnpm health:check` 与 `pnpm smoke:production --expected-version 0.10.0` 的实际输出；
- 500 期间的调用量/影响面（若有 Sentry 或 Vercel Analytics 可查）；
- 一条能提前发现这类故障的告警：目前「函数每次都抛」这种情况只有被动访问才会暴露，
  `health-check.yml` 每天一次、`smoke-main` 每天一次，最坏情况下无人值守 24 小时。
