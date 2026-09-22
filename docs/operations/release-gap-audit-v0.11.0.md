# v0.11.0 发布文档缺口审计 / Exit Report

审计日期：2026-09-22
审计范围：`package.json` 版本 0.11.0、`CHANGELOG.md` 的 `[0.11.0]` 章节（35 条）、
`.github/RELEASE_CHECKLIST.md`、双语 README、`docs/operations/{release,rollback}-runbook-v0.11.0.md`、
`docs/operations/production-smoke-v0.11.0.md`、`docs/operations/drills/*.sql`、
`docs-site/{,zh-CN/}v0.11.0.md`、`supabase/migrations/03*.sql` 与迁移清单、
`docs/operations/release-exit-report-v0.6.0.md`（同一任务池的上一次逐条核对）、
`Production Smoke` workflow 的运行记录，以及 `scripts/check-release-docs.js` 与 `pnpm check:gates`。

方法见 `docs/operations/release-audit-template.md`：**每一条状态都要指向可复现的命令或带日期的执行记录**，
不接受「文档已写」。

## 结论

1. **冻结本身是完整的**：版本号、CHANGELOG 版本章节、发布 / 回滚 / 冒烟三份产物、双语 README、
   docs-site 双语版本页与 checklist 全部对齐，`pnpm check:release-docs` 通过（按当前版本解析 7 个产物）。
   本版本含两条迁移（`032_data_retention_erasure.sql`、`033_upload_object_orphan_audit.sql`），
   且已按 **DB-first** 顺序应用到云端项目并留下只读复核记录。
2. **生产已经跑上 `0.11.0`**（2026-09-22，08:05:33Z 直读 `/api/health` 得 `version=0.11.0`、
   `ready=true`、`mockMode=false`）——但这句话**不**包含「生产 == 当前 `main`」：同一版本号下的
   后续提交在响应里不可区分，事后从 Vercel 部署记录查到生产实际停在 `a322a4e`，
   而 09-22 当天 `indie-stack` 项目又被 `Deployment rate limited` 挡了两次（详见冒烟产物的配额小节）。
   无副作用冒烟 **6/6** 各取了一次本地与 CI 证据（run `35702965727`，artifact zip SHA-256
   `7075985c…dbe1dc`）。
3. **`v0.11.0` tag 不存在，本审计不构成发布通过证据。** 缺两条前置：
   账户删除的隔离账号端到端演练（本版本唯一的不可逆面），以及「部署 commit == 验证 commit」的证明
   —— 当前生产构建的 `/api/health` 不上报 commit（该字段由 PR #69 加入，尚未部署到生产），
   所以外部只能看出「某个 0.11.0 构建是好的」。
4. 取证过程本身又查出三条真实缺陷（见「冻结之后新发现的缺口」）。三条都已修，
   但更重要的是它们说明了同一件事：**当时的冻结检查没有覆盖「证据是怎么产生的」**。
5. 发布 runbook 的范围段与 CHANGELOG 实际内容不一致（见下），属文档准确性缺口。

## 范围口径核对（runbook 声称 vs CHANGELOG 实际）

`release-runbook-v0.11.0.md` 把本版本范围写成「E01–E10、H07–H10、A10、CI/发布门禁（J02–J07）、
依赖稳定化」。按 `[0.11.0]` 章节的 35 条逐项核对：

| 差异 | 实际情况 | 后果 |
| ---- | -------- | ---- |
| 声称在内的 H07 / H09 / H10、E08 / E10 | 本版本章节里**没有**对应条目——它们更早就完成了（索引评审、迁移历史对齐、安全配置检查、health 依赖分级、部署后 health check workflow），列进范围会让人以为本版做过 | 高估本版本改动面 |
| 声称在内的 J06（发布 smoke） | 章节里无条目；本版只做到「无副作用 6/6 + 只读 3/6」，隔离账号 0/14 | 把「部分完成」当成本版交付 |
| 未声称却实际交付 | 整个 D 域：D01 术语门禁、D02/D03 翻译值与错误码门禁、D06 中文渲染 E2E、D08 逻辑方向迁移、D10 静态 a11y 门禁重写（含 3 处 AA 对比度修复与仪表盘 axe 覆盖） | 审查者按 runbook 的范围去看 diff，会漏掉本版**用户可见**变化最大的一块 |
| 任务 ID 有歧义 | `[0.11.0]` 里的 `D01/D02/D03` 是 v0.6.0 任务池的多语言域；`docs/roadmap-0.12.0.md` 里的 `D01/D02/D03` 是文档治理域。同一串编号在两个池子里含义不同 | 引用时不写池子名就会指错东西；本审计一律写成「D01（v0.6.0 池）」 |

结论：范围段应由**发布时的 CHANGELOG 章节生成**，而不是由记忆写成散文。模板里把这条固化成检查项。

## 里程碑退出标准核对（v0.11.0 实际交付项）

| 退出条件 | 证据 | 状态 |
| -------- | ---- | ---- |
| A10 受管对象孤儿可发现 + 删号后对象清理 | 迁移 `033`（`owner_id` 改 `on delete set null` + 3 个 service_role 函数）、`src/lib/uploads/erasure.ts`、`pnpm audit:storage-orphans`（本地栈：0 孤儿；插入 2 条 `owner_id is null` 后报 2 条 / 9.5 MiB / 按 bucket 分组 / `--fail-on-findings` 退出码 2） | 达成 |
| H08 账户数据擦除与保留期 | 迁移 `032`、`src/lib/privacy/data-policy.ts` 双向契约（`data-policy.test.ts`）、`src/lib/account/deletion.ts` 的「先擦除、再删号」、Mock 镜像 + 5 条 Playwright | 代码达成；**生产演练未做** |
| E01 Appark 采样 | `NEXT_PUBLIC_APPARK_SAMPLE_RATE` 解析 + 非法值回退并告警 | 达成 |
| E02 trace 关联 ID | `src/proxy.ts` + `src/lib/trace-id.ts` + `check:trace-coverage` | 达成 |
| E03 cron 调度与指标契约 | `CRON_WORKERS` 注册表 + `check:cron-contract` | 达成，但**核对时语义未达成**：digest 错峰门控与每天一次的调度不兼容，除 UTC-1 外无人被投递；2026-09-22 按用户定案删除门控（PR #64），A04 补上「跳过必须计数」的静态契约（PR #65） |
| E04 邮件队列口径 | `EMAIL_NOTIFICATION_TYPES` 单源 + 仓储层测试 | 达成 |
| E05 / E06 存储与 provider 指标 | `storage-metrics.ts` / `provider-metrics.ts`（含「未配置立即产出 failure 样本」） | 达成 |
| E07 恢复告警契约 | `ops-metrics.ts` 全终态计数 + `alert-thresholds.test.ts` | 达成（Sentry 侧规则是否已配仍需云端权限） |
| E09 演练与 runbook | 两份真库演练脚本（`drills/retention-cleanup.sql`、`drills/account-erasure.sql` 20/20 断言）+ 权限矩阵按真实调用核验 | 数据层达成；**部署回滚 / 凭据轮换 / provider / incident 演练均未做** |
| J02 / J03 E2E 分片与 CI 并行 | `[1, 2]` shard matrix、`check:workflows` 锁拓扑 | 达成 |
| J04 / J05 CodeQL 与 Secrets 强度 | `check:codeql` + `codeql-alert-triage.md`、`check:secrets-scan` + 泄漏响应 runbook | 达成（真实告警列表需 Security 权限） |
| J07 标签与 Release Notes 门禁 | `check:release-tag` + `release.yml` 的 `--notes-file` 路径 | 达成 |
| D 域（未声称，见上） | 5 道 i18n / a11y 门禁 + 74 处物理方向类迁移 | 达成 |
| 依赖稳定化 | `chore(deps): stabilize minor and patch updates`（`3b7a5df`） | 达成 |
| 全量门禁 | `pnpm check:all` / `pnpm verify:build` / `pnpm test:coverage`（数量以命令输出为准） | 达成 |
| 生产冒烟（J06 口径） | 无副作用 6/6；只读 3/6；隔离账号 0/14 | **未达成**（缺可牺牲账号与云端权限） |
| tag / release | 只有 `v0.6.0` 一个标签 | **未执行**（前置未满足，见结论 3） |

## 冻结之后新发现的缺口

这三条都不在当时的冻结清单里，全部是在「去取生产证据」的路上撞出来的。共同点：冻结只验证了
**产物存在**，没验证**产物是怎么产生的、还能不能产生**。

| 缺口 | 之前的问题 | 修复 | 状态 |
| ---- | ---------- | ---- | ---- |
| 手动 smoke 作业从未在定时触发下工作 | `on:` 的 `schedule` 作用于所有作业，而该作业参数取自 `inputs.*`；定时触发时 inputs 为空，每天以 `Error: --timeout-ms requires a value` 失败且从未访问生产（09-21、09-22 两次日志一致）。红色落在错误作业上，把「Production Smoke 失败」变成没有指向的信号 | 作业级 `if: github.event_name == 'workflow_dispatch'` + `check:production-smoke` 新增 `SMOKE_MANUAL_TRIGGER_GUARD_MISSING` | 已修（PR #68） |
| 两个作业共用一个 artifact 名 | 一次 `workflow_dispatch` 留下两份 `production-smoke.json`，实测 `gh run download -n production-smoke-evidence` 只保留后落地的一份且**不报错**，发布记录的「artifact 指纹」不确定属于哪一轮 | 定时作业改名 `production-version-drift-evidence`，并加 `SMOKE_ARTIFACT_NAME_DRIFT` 按契约锁定两个名字 | 已修（PR #68） |
| 生产无法自证 commit | `/api/health` 只有 `version`，同一版本号内的后续提交在生产上不可区分，而回滚判定要求「部署 commit 与验证 commit 相同」 | `/api/health` 新增 `commit`（构建时内联 `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`，回落运行时变量，未知为 `null`）；`pnpm smoke:production --expected-commit` 断言，缺失即失败；定时检查只记录不断言 | 代码已合并（PR #69），**生产侧待部署后复核** |

## 与 v0.10.0 的差异

1. **有迁移**：v0.10.0 是「零迁移」，v0.11.0 有 `032` / `033`，因此发布顺序变成 DB-first，
   回滚语义也多了一条「代码可回滚、schema 只向前」。
2. **有不可逆用户操作**：v0.10.0 是纯 UI 收口，自动化 6 项 + 只读核对足够；v0.11.0 引入账户删除链路，
   其正确性无法从外部观测（health 全绿证明不了擦除按顺序发生、也没多删），
   所以冒烟矩阵把隔离账号演练列成打 tag 的必要条件——这是本审计判定「未发布」的直接依据。
3. 门禁面继续扩大（cron 契约、双语调度事实、包体积进 CI 等），数量以 `pnpm check:gates` 输出为准。
4. 生产状态：v0.10.0 审计时生产仍是 `0.6.0`（5/6）；v0.11.0 审计时生产已是 `0.11.0`（6/6），
   但 tag 依然只有一个——**「生产已是新版本」和「版本已发布」不是一回事**，别用前者给后者背书。

## 未闭合项（作为 v0.12.0 输入，编号见 `docs/roadmap-0.12.0.md`）

| 项 | 内容 | 为什么没在本版关掉 |
| -- | ---- | ------------------ |
| B02 | 真实回滚演练（v0.6.0 起 J08 从未闭合） | 需 Vercel deployment 切换权限；现在还需要 commit 上报可用，否则「回到哪个构建」无法证明 |
| B03 | 隔离账号的账户删除全链路（真实 `auth.admin.deleteUser` + 真实 bucket 对象） | 需可牺牲账号；数据层等价演练（20/20）不能替代 |
| B04 | 云端 Supabase 上的保留期与擦除同型演练 | 需云端执行权限 |
| B05 | provider 与 incident 演练 | 需 provider 测试凭据 |
| — | pg_cron 未安装（两个环境） | 需 Supabase Dashboard 权限；本版另加了应用侧 `/api/cron/retention` 作为执行者（在 `[Unreleased]`） |
| — | digest 新语义的生产观察（一轮 09:00 UTC，`sent>0` 且 `email.backlog` 不再单调增长） | 需部署 + 观察窗口 |
| A05 | 不可投递条目永远出不了队列（无邮箱 / 偏好全关），会占住按 `created_at` 升序的前 100 条拉取窗口 | 出队语义是产品决策，三个候选都会改变 admin 面板与指标口径 |
| A01 剩余 | `profiles.timezone` 失去全部功能性消费者，资料页却仍要求填写 | 产品决策 |
| C06 | `src/lib/actions/uploads.ts` 两个无调用方的 Server Action | 产品决策（保留为编程入口或删除） |
| C01 / C02 | mock 请求级隔离（含 MFA 进程全局）与其后的可复跑并行基线 | 工作量大，属下一版 |
| D01 / D03 | docs-site 可机器核对的事实；本文件所属系列在 v0.10.0 之后断档（本文件即补档） | 同日双双关闭：D03 是本文件与 `release-audit-template.md`，D01 由 `check:cron-contract` 的文档核对承担 |

## 可复现验证

在目标 commit 的干净 checkout 中至少运行：

```bash
pnpm check:release-docs
pnpm check:changelog
pnpm check:gates
pnpm check:cron-contract
pnpm check:production-smoke
pnpm check:bilingual-docs
pnpm check:migrations
pnpm check:supabase-security
pnpm check:all
pnpm verify:build
pnpm test:coverage
pnpm test:e2e
pnpm audit --audit-level high
node scripts/production-smoke.js https://indie-stack-theta.vercel.app --expected-version 0.11.0
pnpm audit:storage-orphans
```

云端只读核对（需凭据，结果记在发布 runbook 差异 1）：

```bash
supabase migration list --linked          # 期望 001–033 全部 applied
supabase db push --linked --dry-run       # 期望为空
```

## 本审计自身无法核对的部分

- 任何需要 Vercel / Supabase / Sentry / Resend / Stripe 控制台或凭据的事实（部署记录、告警规则是否真的配置、
  provider 侧行为、备份与 PITR）。
- 需要隔离账号或真实用户数据的场景（账户删除、上传、登录、发信、真实推送）。
- GitHub Security insights 里的 CodeQL 告警列表与历史扫描结果（需 `security-events: read`）。

以上一律记为「未执行 / 未验证」，不得由「门禁全绿」推断。
