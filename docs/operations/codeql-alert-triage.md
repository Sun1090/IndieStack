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
- 告警计数与对比需要 GitHub 安全 API，**本地无法复现**，因此 `pnpm check:codeql` 只保证扫描强度与
  处置策略不漂移，不保证数量不变（见下节）。

## 外部依赖

- 读取真实告警列表、对比基线分支、确认 dismissal 记录，都需要 **GitHub 仓库的 code scanning 权限**
  （`security-events: read`）与可用 token；本地与无凭据环境无法执行。
- 定时扫描与历史告警状态由 GitHub 侧保存；仓库只保存扫描配置。
- 因此本 runbook 的「零回归」结论必须在有 GitHub 访问权限的环境（发布负责人或 CI）里确认。

## 相关门禁

- `pnpm check:codeql`：校验工作流扫描强度（语言、套件、action major、权限、超时、分支覆盖、定时、路径排除）
  与本文档的事实一致性。
- `pnpm check:security`：校验扫描器仍被启用（analyze 存在、套件、`security-events: write`）。
- `pnpm check:workflows`：校验工作流卫生（固定版本、超时、`needs`、并发取消）。
