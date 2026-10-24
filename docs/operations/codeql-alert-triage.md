# CodeQL 告警分诊 Runbook

> 本文档是 **CodeQL / code scanning 告警处置流程的单一事实来源**。文中出现的套件名、严重度阈值、
> 修复 SLA 与允许的 dismissal 理由都被 `pnpm check:codeql` 校验；改这里必须同时改
> `src/lib/security/codeql-alert-policy.ts` 的 `CODEQL_CONTRACT`，否则门禁失败。
>
> 扫描本身由 `.github/workflows/codeql.yml` 执行：`javascript-typescript` 语言、`security-extended`
> 查询套件、`github/codeql-action@v4`、push `main`/`develop` + pull_request `main` + 每周一 06:00 定时扫描。

## 适用范围

- 覆盖 GitHub → Security → Code scanning 下由 CodeQL 产生的全部告警，包括 PR 检查与默认分支的历史告警。
- 不覆盖：gitleaks 密钥泄漏（见 `.github/workflows/secrets-scan.yml`）、依赖漏洞（Dependabot / `pnpm audit`）、
  Supabase RLS 与 storage 策略（见 `pnpm check:rls` / `pnpm check:supabase-security`）。
- 生产环境的越权与数据外泄告警另按 `.github/SECURITY.md` 的漏洞报告流程处理。

## 严重度与阻断阈值

CodeQL 结果里的 `security-severity` 是 0–10 的 CVSS 风格分值，按分值分级处置：

| 分值 | 级别 | 处理要求 |
|------|------|----------|
| ≥ 7.0 | 阻断 | 必须在合并前修复；未修复不得进入 main |
| 4.0 – 6.9 | 高 | 允许合并，但必须建 issue 并在 5 个工作日内完成分诊 |
| < 4.0 | 中低 | 记录进 issue 列表，随技术债排期 |

- **阻断阈值 = 7.0**：`security-severity >= 7.0` 的告警在 PR 上直接阻断合并。
- 例外只能走 dismissal，且必须写下理由与责任人（见下节）。

## 分诊流程

1. **发现**：PR 检查、`main` 推送后的扫描，或每周一 06:00 的定时扫描。
2. **定位**：打开 GitHub → Security → Code scanning → 对应告警，确认 `category` 为
   `/language:javascript-typescript`（category 漂移会让历史状态失联，属配置事故）。
3. **判定**：阅读数据流路径，判断是真实可达（真阳性）还是不可达 / 已在下游校验（假阳性）。
4. **处置**：真阳性 → 修复并让告警自动关闭；假阳性或测试代码 → 按 dismissal 规则关闭。
5. **记录**：在 issue 里写清告警规则 ID、修复 PR 或 dismissal 理由与责任人。
6. **SLA**：从告警首次出现到完成分诊，**5 个工作日**内必须有结论；未结案要在发布检查中列为风险。

## Dismissal 规则

只允许使用 GitHub 内置的三个理由，其余一律先修复或先讨论：

| 理由 | 使用条件 |
|------|----------|
| `false positive` | 数据流实际不可达，或已有等价的下游校验；需在评论里贴出证据 |
| `won't fix` | 风险已被独立控制（如该路径仅管理员可达）且有明确接受人 |
| `used in tests` | 命中位置只在测试代码里，且不可能进入生产构建 |

- 不允许使用「过时告警」等自定义理由绕过；不允许批量 dismiss 后不记录。
- 每条 dismissal 必须留下：判定人、日期、证据链接（上游 issue 或代码行）。

## 零回归的判定

「零回归」指**相对基线分支没有新增未处置告警**，而不是「告警总数为 0」：

- 基线取 `origin/main` 最近一次已完成的 CodeQL 扫描。
- PR 上出现的新告警必须满足：严重度 < 7.0 且已建 issue，或已按上节规则 dismissal。
- 已存在的历史告警允许保留，但数量不得增长；每次发布收口时在 gap audit 中记录当前计数与变化。
- 计数与对比由 `pnpm ops:codeql-alerts` 做：它把 GitHub 实况与 `CODEQL_ALERT_REGISTRY`
  （`src/lib/security/codeql-alert-registry.ts`，本文件末尾那批读数的结构化形态）逐条对账，
  新增未登记、台账腐烂、复核过期、阻断级仍 open、分诊超 SLA 都会红。
  2026-10-13 之前的说法是「本地无法复现」，**那是错的**——见下节。
  `pnpm check:codeql` 仍然只管扫描强度与处置策略不漂移，不管数量。

## 外部依赖

- **2026-10-13 实测推翻本节旧表述**（原文：「读取真实告警列表…本地与无凭据环境无法执行」）。
  本仓库是 public，但 `GET /repos/{owner}/{repo}/code-scanning/alerts` 匿名返回 **401**；
  而本机 `gh` 的 token 就能读到全部字段（编号、规则 ID、`security_severity_level`、`created_at`、
  实例 path、`dismissed_reason`）。所以缺的一直不是权限，是没人写这个探测——现在有了：
  `GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY=Sun1090/IndieStack pnpm ops:codeql-alerts`。
- ⚠️ **严重度字段在 `rule` 下面**：`rule.security_severity_level`。**顶层没有这个键**
  （实测 `'security_severity_level' in alert === false`，`'severity' in alert === false`），
  所以从顶层取会稳定得到 `null`，而 `null` 看起来完全像「GitHub 没给这条告警评分」。
  - **本节第一版把原因写成「只在带 `x-github-api-version: 2022-11-28` 时才有值」，那是错的**，
    错因是**对照实验本身不成立**：我用 `gh api` 跑「不带 header」那一组，而 `gh` 自己会补默认
    api-version ⇒ 两组都带了 header，看到的差异根本不在 header 上。改用 `curl` 严格对照后：
    不带 header / 带 `2022-11-28` / 带 `2026-03-10` ⇒ `rule.security_severity_level` **都有值**。
    不带 header 时 GitHub 实际选中的版本由响应头 `x-github-api-version-selected` 给出，实测就是 `2022-11-28`。
  - header 仍然带着，但理由与严重度无关：**不受支持的版本值直接 HTTP 400**
    （实测 `2023-03-02` 的 `errors` 逐字为「supported versions are "2026-03-10" (most recent) and
    "2022-11-28"」），钉住 `2022-11-28` 是为了让读数可复现、不被平台的版本演进悄悄改掉。
- **不要用查询参数筛严重度**，取回来自己判。实测 `severity=` 的行为有两种歧义，合起来不可用：
  - 它过滤的字段是 `security_severity_level` 而**不是** `rule.severity`：
    `severity=high` 只回 #18，而 #18 的 `rule.severity` 是 `warning`。
  - **无法识别的取值被静默忽略并返回全部**：`nonsense` / `none` / `info` / `moderate` / `unknown`
    都回全部 5 条 ⇒ 「拼错了」和「全都命中」在响应上**无法区分**。
  - （第一版这里写的是「`severity=error` 返回 0 条 ⇒ 过滤器生效」——那推不出来：
    `error` 是合法枚举值且确实没有告警取该值，所以 0 条既可能来自「按 `rule.severity` 过滤」
    也可能来自「按 `security_severity_level` 过滤」。真正的证据是上一条的 #18。）
  - `security_severity_level=` 这个参数则被**完全忽略**（high/critical/medium/7.0 一律回全部 5 条）。
- 判定层拒绝把 `null` 当低危，它报 `CODEQL_ALERT_SEVERITY_UNKNOWN`。
  映射逻辑（`toLiveAlert`）已从 IO 层搬进 `src/lib/security/codeql-alert-registry.ts` 并配单测——
  **它待在 `scripts/lib` 时一行测试都没有，所以那句错误的因果解释没有任何检查能拦住。**
  IO 层剩下的部分（`fetchOpenAlerts` / `readFixture` / `parseArgs` / 退出码）在 2026-10-13
  也补上了单测（`src/lib/security/codeql-alert-io.test.ts`，19 条）——它钉的是
  **「读不到」绝不能长得像「一切正常」**：五类失败路径都返回 `{error}`，
  而真读到空列表才返回 `[]`。这条分界一旦写反（把失败也返回 `[]`），探测会以退出码 **1**
  报出一堆「台账腐烂」而不是 **2** 的「未知」——**它看起来像查过了**，而那才是最难发现的错法。
  **改这一层之前先跑那个文件**，它是这条探测唯一的兜底。
- 无 token 环境（fork PR、未配凭据的机器）能跑离线复现：`pnpm ops:codeql-alerts --fixture
  fixtures/codeql-alerts.json`，它录的是 2026-10-13 的真实形状（含一条 null 严重度与一条未登记告警）。
  读不到实况时探测以退出码 2 结束并报 `CODEQL_ALERT_LIVE_UNREADABLE`——**未知不算通过**，
  但也绝不据此声称「零回归」。
- 定时扫描与历史告警状态由 GitHub 侧保存；仓库只保存扫描配置。
- 「零回归」结论由 `pnpm ops:codeql-alerts` 的读数给出，不再依赖某个有权限的人手工确认。
- 它**刻意没有**接进 `check:all` 或任何 workflow：台账里 #18 目前未结案，这条探测此刻是红的，
  进 PR 门禁会阻塞每一个 PR。`ops:` 前缀表示「需要凭据的运维探测」，与 `ops:schema-drift`、
  `ops:migration-status` 同类。等 #18 结案后再考虑接进定时只读 workflow。

## 相关门禁

- `pnpm check:codeql`：校验工作流扫描强度（语言、套件、action major、权限、超时、分支覆盖、定时、路径排除）
  与本文档的事实一致性。
- `pnpm ops:codeql-alerts`：把 GitHub 实况与下方告警台账对账（需要 `GITHUB_TOKEN`，或用 `--fixture` 离线跑）。
- `pnpm check:security`：校验扫描器仍被启用（analyze 存在、套件、`security-events: write`）。
- `pnpm check:workflows`：校验工作流卫生（固定版本、超时、`needs`、并发取消）。

## 修复已合并但告警仍在：判定与处置口径

2026-10-11 在 `main` 上实测到的形态：`js/log-injection` 告警 #11/#12/#13/#17 的
最新实例仍指向 `refs/heads/main` 的 `0762253e`，而修复提交 `600af8a1`
（committer 日期 2026-09-27）**已经是 `0762253e` 的祖先**，`sanitizeLogText()` 也确实在
main 版本的 `src/lib/logger.ts` 里被调用。同时 main 在 09-27 之后有多次扫描记录
（10-05 / 10-06 / 10-08 等）。结论：**这不是「扫描没跑」，也不是「修复没生效」**。

原因是 CodeQL 的判定模型：它只认库自带的 sanitizer 与 model pack，
**不认识本项目自己写的 `sanitizeLogText()`**。所以「代码里已经有净化」在 CodeQL 眼里不构成
数据流终止条件，告警会一直存活。这正是 2026-09-24 台账里对 issue #132 立下的预言被证实。

处置口径（按顺序）：

1. **先证伪「还有真缺陷」这件事**，用数据流而不是用「我觉得已修」：确认修复提交在告警所指 commit
   的祖先里、确认净化函数在 main 版本的调用点上、确认 main 在该日期之后确有扫描。三条都成立，
   才允许说「告警存活是 sanitizer 不可见，不是缺陷未修」。
2. **不要为此批量 dismiss**。09-24 已立规矩：不在合并前批量 dismiss、不擅自改告警状态。
   要消掉这类告警，正确路径是给 CodeQL 提供 **model pack**（把 `sanitizeLogText` 声明为
   sanitizer），让规则自己看见；这是配置工作，不是分诊工作。
3. **同一条规则要反向复查真阳性**。CodeQL 看不见自定义 sanitizer，同样也可能看不见
   「真正的弱点在别的文件」。2026-10-11 就是这么发现的：`js/insufficient-password-hash`
   报在 `src/lib/repositories/marketing.ts:14`，而那里哈希的是 24 字节随机订阅 token
   （高熵机器凭据，用快速哈希是对的）⇒ 假阳性；同一条规则（CWE-916）的**真阳性位置**是
   `src/lib/actions/recovery-codes.ts` 里未加盐的 SHA-256 ——**CodeQL 一条都没报**。
   所以「去看告警报了哪里」和「去看这条规则该报哪里」是两个动作，只做前者会漏。

- 本仓库当前 open 告警（2026-10-12 读数，5 条）：`js/log-injection` #11/#12/#13/#17
  （`error` / medium，已修复但 sanitizer 不可见）、`js/insufficient-password-hash` #18
  （`warning`，`security_severity_level=high`）。
  **#18 已于 2026-10-12 完成分诊：判定假阳性，证据与判据见 issue #242**
  （命中处哈希的是 24 字节随机订阅 token ⇒ 192 位熵，不是口令；慢哈希与加盐在此不改变攻击可行性）。
  仍**未 dismissal**——按本文档的规矩，改告警状态要 maintainer 决定，
  分诊记录与状态变更是两件事。
  同一条规则的反向复查产出的真缺陷（恢复码未加盐 SHA-256）已由 PR #237 修成加盐 scrypt。
- 告警清单、严重度、实例所指的 `ref`/`commit` 都要用 `GET /repos/{owner}/{repo}/code-scanning/alerts`
  取，不要凭记忆复述规则名或告警编号。
