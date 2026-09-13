# v0.9.0 发布文档缺口审计

审计日期：2026-09-13
审计范围：`package.json` 版本 0.9.0、`CHANGELOG.md`、`.github/RELEASE_CHECKLIST.md`、双语 README、
`docs/operations/release-*-v0.9.0.md`、`docs-site/{,zh-CN/}v0.9.0.md`、`scripts/check-release-docs.js`
与 CI 门禁。

## 结论

v0.9.0 完成了本地 `RELEASE_FREEZE`：版本号、CHANGELOG、发布/回滚/smoke runbook、双语 README 与
docs-site 版本页已对齐，`pnpm check:release-docs` 在 `package.json` 版本为 0.9.0 时通过。
**生产 smoke 仍未执行**，本审计不构成发布通过证据；在获得 push / merge / deploy 授权前，
`docs/operations/production-smoke-v0.9.0.md` 保持“未执行”。

## 缺口与交付物

| 缺口                       | 之前的问题                                                                 | 本次交付物                                                                     | 当前证据                            | 状态                 |
| -------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------- | -------------------- |
| 上传孤儿对象不可枚举       | 只 `put` 不登记，bucket 与业务表双向差集无法计算，替换/回滚失败即留孤儿     | 迁移 031 `public.upload_objects` + repository + service 失败封闭回滚            | 单测 + 本地 psql 身份矩阵           | 已实现               |
| Storage 策略审计写死       | bucket 名硬编码为 `avatars`，新增 bucket 不会被策略门禁发现                 | `src/lib/security/storage-policies.ts` 7 类失败封闭规则 + 20 条单测             | `pnpm check:supabase-security` 通过 | 已实现               |
| SECURITY DEFINER 默认授权  | `PUBLIC` 默认持有 `EXECUTE`，匿名可 `rpc` 强制清理或伪造审计日志            | 迁移 028 收回 4 个函数对 `PUBLIC` / `anon` / `authenticated` 的 `EXECUTE`       | 门禁失败封闭 + 本地角色矩阵         | 已消除               |
| 审计日志客户端可写         | 遗留宽松 INSERT 策略允许任意登录用户伪造 `user_id` 指向他人的审计记录       | 迁移 029 删除策略 + 收回 `anon` / `authenticated` 的 INSERT/UPDATE/DELETE/TRUNCATE | 本地复现 HTTP 201 → 403             | 已消除               |
| Stripe webhook 重放副作用  | 先执行副作用再 upsert，at-least-once 重投会重复写订阅、重复发通知             | 迁移 030 租约模型 `claim_webhook_event()` + `(provider, event_id)` 唯一键        | 单测 + E2E 断言副作用行数           | 已实现               |
| 旧邮件 worker 记录无保留期 | `email_worker_runs` 无清理任务，长期运行持续膨胀                             | 迁移 027 `cleanup_old_email_worker_runs()`（90 天）+ 带守卫的 `pg_cron` 任务      | 单测 + 真实本地 Supabase 验证        | 已补齐               |
| service_role 边界无人清点  | 任意新路由 import 一次 admin client 即可绕过评审读写任意表                   | `src/lib/security/admin-client-boundary.ts` AST 清单，30 模块 / 83 调用点       | `pnpm check:supabase-security` 通过 | 已补齐               |
| RLS 门禁漏检策略           | `check:rls` 按单个单词截断策略名，35 条只校验 24 条                          | `src/lib/security/rls-coverage.ts` 最终态模型 + 14 条单测 + 未分类表规则         | 静态/运行时双向零差集               | 已消除               |
| 队列可观测性               | —（v0.8.0 已交付，本版本沿用）                                              | 契约不变                                                                        | `sentry-alerts.md`                  | 沿用                 |
| 迁移漂移                   | 新增 5 个迁移必须纳入 SHA-256 清单                                          | `migration-manifest.json` 更新为 31 条，`pnpm update:migrations-manifest` 生成  | `check:migrations` 通过             | 已消除               |
| 发布 checklist 版本        | checklist 仍指向 v0.8.0 产物与 tag                                          | `.github/RELEASE_CHECKLIST.md` 更新为 v0.9.0 tag 与三个 v0.9.0 文档链接          | 门禁读取 checklist 校验             | 文档已补齐           |
| README 发布入口            | 双语 README 链接旧版本 runbook/smoke                                        | `README.md`、`README.zh-CN.md` 指向 v0.9.0 产物并由门禁校验                     | `check:release-docs` 通过           | 文档已补齐           |
| docs-site 版本页           | 新版本没有中英发布说明页                                                    | `docs-site/v0.9.0.md`、`docs-site/zh-CN/v0.9.0.md` 并注册到导航与侧边栏          | 中英页面各 1 个                     | 文档已补齐           |
| v0.9.0 smoke 证据          | 直接复制 v0.8.0 smoke 会把历史证据误认成本版本通过                          | `production-smoke-v0.9.0.md` 重写为干净“未执行”基线，并新增迁移/上传/权限/幂等行 | 状态：未执行                        | 执行记录待发布时填写 |
| Push 重试链路 E2E          | —（v0.8.0 已交付，本版本沿用）                                              | 契约不变                                                                        | `pnpm test:e2e` 通过               | 沿用                 |

## 与 v0.8.0 的差异

1. 本版本**新增五个数据库迁移**（027–031），全部为追加式，最新迁移号由 026 前进到 031。
   其中 030 与 031 改变了应用与 schema 的耦合方式：**必须先迁移再部署**，回滚**必须先回滚代码**。
2. `webhook_events` 的幂等语义从“最后写一行日志”变为**租约占位模型**：重复投递返回 `duplicate`
   且不执行副作用，副作用失败回 500 让 Stripe 重试后可重新占位，`received` 超过 15 分钟可回收。
3. 上传路径从“尽力写元数据”变为**失败封闭**：元数据写失败即删除已上传对象并返回 `uploadFailed`，
   不再产生没有登记的公开对象；旧对象删除失败则不标记 `deleted`，避免孤儿漏报。
4. 服务端权限面收窄：`PUBLIC` / `anon` / `authenticated` 的 `EXECUTE` 与 `audit_logs` 写权限被收回，
   只有 service_role 可执行清理函数与写审计日志。
5. 发布前外部条件不变：VAPID 密钥对、HTTPS 站点、`CRON_SECRET`、Supabase Management API token。

## 可复现验证

在目标 commit 的干净 checkout 中至少运行：

```bash
pnpm check:release-docs
pnpm check:changelog
pnpm check:docs
pnpm check:all
pnpm verify:build
pnpm test:e2e
pnpm audit --audit-level high
pnpm --filter indiestack-docs build
```

其中 `check:release-docs` / `check:changelog` / `check:docs` / `check:all` 属于本地门禁，
`verify:build`、E2E、audit 必须在目标发布 commit 上重新执行，不能用本审计文件替代。

## 发布前仍需产生的真实证据

1. 从目标 commit 的干净 checkout 保存完整 `pnpm verify:build`、E2E、coverage 与 audit 输出。
2. 在生产环境按顺序应用 027–031，保存 `supabase migration list` 输出证明 001–031 全部 applied，
   并用 `pnpm check:supabase-security` / `pnpm smoke:supabase-identity` 对生产目录回读。
3. 完成一次真实上传（头像或封面），确认 `upload_objects` 出现 `status='active'` 行，且
   bucket 与表双向差集为空；再验证一次元数据写失败时的对象回滚。
4. 用 Stripe test-mode 签名生成器向生产/隔离环境投递同一事件两次，确认副作用行数仍为 1；
   再制造一次副作用失败，确认 `attempts` 递增且最终成功。
5. 填写 `production-smoke-v0.9.0.md` 每一行，附 UTC 时间、HTTP 状态和脱敏证据。
6. 生成 v0.9.0 exit report；任一退出标准失败时保持版本未发布并创建修复 issue。
