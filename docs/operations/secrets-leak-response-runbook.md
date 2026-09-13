# Secrets 泄漏响应 Runbook

> 本文档是 **gitleaks 密钥泄漏处置流程的单一事实来源**。文中出现的工作流行为、首次响应时限、
> 轮换时限与允许的 allowlist 理由都由 `pnpm check:secrets-scan` 校验；改这里必须同时改
> `src/lib/security/secrets-scan-policy.ts` 的 `SECRETS_SCAN_CONTRACT`，否则门禁失败。
>
> 扫描本身由 `.github/workflows/secrets-scan.yml` 执行：`gitleaks/gitleaks-action@v3`、
> `fetch-depth: 0` 全历史扫描、push `main`/`develop` + pull_request、`GITHUB_TOKEN` 只读接线。

## 适用范围

- 覆盖 gitleaks 在 push、pull_request、手工补扫和发布前审计中发现的全部凭据类命中。
- 不覆盖：CodeQL 代码告警（见 `docs/operations/codeql-alert-triage.md`）、依赖漏洞（Dependabot / `pnpm audit`）、
  Supabase RLS 与 storage 策略（见 `pnpm check:rls` / `pnpm check:supabase-security`）。
- 生产环境的账号滥用、未授权访问与数据外泄另按 `.github/SECURITY.md` 的漏洞报告流程处理。

## 立即响应

1. 发现命中后 **10 分钟** 内建立 incident 频道，记录发现时间、扫描运行链接、规则 ID、仓库与提交 SHA。
2. 先在 gitleaks 报告里完成初步真实性判断：比对命中字符串是否仍可认证、是否只是测试占位符、
   是否存在明确的上游来源；不要在公开 issue 或聊天里粘贴完整凭据。
3. 如果命中是真实凭据，立即按凭据类型执行最小撤销：轮换 token / password / signing key，
   或临时吊销对应凭据，再继续调查。
4. 指定 incident owner 与记录人；所有判断、证据链接和操作时间写入 incident 记录。
5. 如果无法在首次响应窗口内确认影响范围，按最坏情况启动轮换，不等待完整取证。

## 影响范围判定

- 确认泄漏是从哪个提交、分支、tag、构建产物或日志进入的，以及该提交是否已经进入
  `main`、`develop` 或发布产物。
- 使用 `git log -S`、gitleaks 全历史报告和 CI 运行记录确认是否还有同一凭据的其他命中。
- 判断凭据权限：只读 / 可写、可访问的仓库或服务、是否能导出数据、是否能创建或删除资源。
- 检查访问日志、审计日志和用量异常；凭据可能已经被使用时，记录检索时间窗口。
- 判定结果写入 incident：受影响系统、数据范围、是否已发生滥用、证据链接和残留风险。

## 处置与验证

1. 在凭据提供方完成撤销或轮换；优先使用新凭据并确认旧凭据立即失效。
2. 从代码、配置、生成物与历史可检索位置移除秘密。**不要**只把最新提交里的值删掉而保留历史命中。
3. 更新部署环境、CI secrets、本地开发说明与任何外部集成；确认没有遗漏的消费者。
4. 运行 `pnpm check:security` 和 `pnpm check:secrets-scan`，确认扫描强度、allowlist 与工作流接线没有漂移。
5. 触发一次 gitleaks 全历史扫描，确认原命中消失且没有新增未处置命中。
6. 在 **24 小时** 内完成真实凭据的轮换与验证；无法完成时必须在 incident 里写明剩余风险、责任人和截止时间。
7. 发布前把 incident 结论、验证命令和残余风险登记到 release checklist 或 gap audit。

## 历史记录处理

- 泄漏凭据必须在提供方轮换，不能依赖改写 Git 历史来「修复」；共享分支历史不由 incident 处理流程重写。
- 如果命中只存在于未合并的功能分支，可以删除该分支或移除对应提交；这不能替代凭据轮换。
- 如果秘密进入已发布的 npm 包、Docker 镜像、构建 artifact 或文档，必须删除或失效对应发布物，
  并记录受影响版本与撤回方式。
- 历史命中在 gitleaks 报告中保留为已处置记录；不得为了让报告变绿而扩大 allowlist。
- incident 结束后复盘根因，补充 pre-commit、CI 检查、secret management 或开发文档，避免同类问题复发。

## Allowlist 规则

- 默认 allowlist 为空；只有同时满足「命中不是可用凭据」且「有可复核证据」才允许登记。
- 仅允许两类理由：`false positive`（数据流不可达或字符串不具备认证能力）与
  `used in tests`（只存在于测试 fixture，且不可能进入生产构建或发布产物）。
- 每条 allowlist 必须写明规则 ID、路径或正则、理由、责任人、到期复核日期和证据链接。
- allowlist 只能放在 `.gitleaks.toml` 的 `[allowlist]` / `[[allowlists]]` 段；`paths` / `regexes` /
  `stopwords` / `commits` 的每条值都必须登记在 `pnpm check:secrets-scan` 的 `allowedAllowlistEntries`。
- 不允许用 `condition`、宽泛目录或空正则掩盖真实命中；扩大 allowlist 必须走代码评审并说明为什么轮换不可行。

## 外部依赖

- 真实历史扫描与 GitHub 告警状态在 CI runner / GitHub 侧，本地只能验证工作流强度、allowlist 与文档事实一致。
- 凭据撤销、轮换和访问日志通常需要对应服务的管理员权限；这些权限不在仓库内。
- 发布后的扫描结果、artifact 撤回和 deployment smoke 需要 GitHub、registry 与生产环境访问权限。

## 相关门禁

- `pnpm check:secrets-scan`：校验 gitleaks 工作流、`fetch-depth: 0`、权限、allowlist、runbook 章节与事实。
- `pnpm check:security`：校验 secrets scanner 工作流仍存在、action major 与最小权限没有漂移。
- `pnpm check:workflows`：校验工作流卫生（固定版本、超时、`needs`、并发取消）。
