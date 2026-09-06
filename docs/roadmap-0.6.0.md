# IndieStack v0.6.0 Roadmap

> 主题：**可上传、可通知、可验证、可观测**
> 基线：v0.5.0（邮件全链路、OSS 基础接线、Passkey 试点、Admin/Contact/MFA E2E）→ 目标：v0.6.0
> 本文件先固定完整任务池与退出标准；每个任务实施时再拆成代码、测试、文档和发布子任务。
>
> **排期原则**：先补测试隔离与安全边界，再扩大外部能力；所有外部 provider 均保留 mock/fallback，生产开关默认安全关闭。

> **进度（2026-09-06）**：C01–C10 已完成；F01–F10 已完成（F01 Mock MFA 状态隔离、F02 request-scoped mock store 第一阶段、F03 file-backed fixture 评估、F04 fullyParallel 隔离实验、F05 webhook events E2E、F06 audit logs 详情 E2E、F07 storage 上传失败/重试 E2E、F08 email provider contract tests、F09 coverage branch 90% 门禁、F10 CI artifact/coverage 告警清理）。A01–A03 已完成（provider contract、服务端中转 action、上传白名单）；其余任务按 M1→M2→M3→M4 推进。

## 任务池（100 项）

### A. 对象存储与上传（A01–A10）

1. A01 OSS provider 接口与能力矩阵（完成：统一 `StorageDriver` contract，暴露 provider/capabilities，并覆盖 Supabase signed URL/remove 能力）
2. A02 服务端中转上传 action（完成：`uploadAvatar`/`uploadProjectCover` 统一经 Server Actions 鉴权、读取、存储写入、数据库回写和缓存失效；覆盖未登录、项目不存在、团队角色、存储失败与回写失败）
3. A03 MIME/扩展名/文件大小白名单（完成：仅允许 PNG/JPEG/WebP；扩展名由 MIME 映射生成；头像限制 2MB；覆盖空文件、PDF、超限和路径穿越输入）
4. A04 对象 key 命名与租户边界
5. A05 签名 URL 生成与过期校验
6. A06 OSS 配置完整性诊断
7. A07 Supabase Storage fallback
8. A08 头像上传接入 profile
9. A09 项目封面与附件接入
10. A10 删除、孤儿对象清理与审计

### B. 推送与通知统一（B01–B10）

11. B01 PWA manifest 能力评估
12. B02 service worker 生命周期策略
13. B03 Web Push 订阅表迁移
14. B04 订阅注册/撤销 action
15. B05 通知权限与设置 UI
16. B06 Web Push provider 抽象
17. B07 邮件/Web Push 偏好统一
18. B08 通知去重键与幂等
19. B09 失败重试与死信统一
20. B10 通知链路 E2E

### C. MFA 与认证安全（C01–C10）

21. C01 Mock MFA factor 状态切换与测试
22. C02 MFA enrollment UI E2E
23. C03 MFA challenge 登录流程
24. C04 恢复码生成、轮换与消费
25. C05 恢复码安全存储与脱敏
26. C06 错误、过期、重试锁定策略
27. C07 会话设备列表与元数据
28. C08 单设备吊销与全局登出
29. C09 安全审计日志详情
30. C10 认证边界与 RLS 回归

### D. 多语言与可访问性（D01–D10）

31. D01 术语表与翻译贡献规范
32. D02 公共页面翻译完整性扫描
33. D03 dashboard 页面翻译完整性扫描
34. D04 next-intl missing-key build gate
35. D05 语言切换状态持久化
36. D06 语言切换 E2E
37. D07 表单错误消息双语覆盖
38. D08 RTL/长文本布局评估
39. D09 键盘导航与焦点回归
40. D10 自动化 a11y 门禁

### E. 可观测性与运维（E01–E10）

41. E01 Appark 生产采样配置
42. E02 request/route trace 关联 ID
43. E03 cron worker 指标结构化
44. E04 邮件队列积压指标
45. E05 OSS 上传成功率指标
46. E06 provider fallback 指标
47. E07 告警阈值与去重
48. E08 health endpoint 依赖分级
49. E09 运维 runbook 与故障演练
50. E10 发布后 health check 自动化

### F. 测试基础设施（F01–F10）

51. F01 Mock MFA 状态隔离（本轮优先）
52. F02 request-scoped mock store 方案（第一阶段完成：`createMockRequestStore` 与隔离测试）
53. F03 file-backed E2E fixture 评估（完成：运行时暂不引入，采用 request-scoped store；离线快照需脱敏与临时目录隔离）
54. F04 恢复 fullyParallel 的隔离实验（完成：显式开关实验 31/31 通过但有 dev server 并发噪声，默认仍串行）
55. F05 webhook events E2E（完成：mock 表 webhook_events + Mock-only 查询/清理端点 + 签名缺失/无效 400、未知与 invoice 事件落库 skipped、重复 event id 幂等、Bearer 保护 4 类断言）
56. F06 audit logs 详情 E2E（完成：mock audit_logs 对齐真实 schema——entity_type/entity_id/metadata、bigint identity 自增、profile 默认 super_admin；audit 页面 action 徽标修复点号→冒号翻译键映射 （消除 MISSING_MESSAGE）+ 行 data-testid；E2E 覆盖详情字段渲染 / action 搜索与空态恢复 / Select 分组过滤 3 类断言；顺带修复 mock profiles 表 10 行重复 id（mock-user-001）导致的 React key 重复与关联错配）
57. F07 storage 上传失败/重试 E2E（完成：mock storage 层与 supabase-js 对齐——from().upload/getPublicUrl + failNext 注入计数；Mock-only /api/e2e/mock-upload 端点；E2E 覆盖空文件 fileRequired / PDF fileTypeUnsupported / 超 2MB fileTooLarge / 注入失败 uploadFailed→重试成功写回 avatar_url 4 类断言；修复 bodySizeLimit=2mb 与 AVATAR_MAX_BYTES 相等导致 >2MB 请求先触达框架上限、fileTooLarge 分支不可达的缺陷（抬至 3mb 留出 multipart 开销余量））
58. F08 通知 provider contract tests（完成：Resend 发送通道契约测试——`email-send.ts` 导出 `DEFAULT_RESEND_ENDPOINT/DEFAULT_EMAIL_FROM` 单一事实源并注释固化契约；新增 `email-send.test.ts` 10 用例锁定 默认端点与 `RESEND_API_URL` 覆盖、`Authorization: Bearer` + JSON 头、body 形状（from 默认/`RESEND_FROM` 覆盖、to 恒为数组）、缺 key 抛错且不发请求、2xx 静默 resolve、非 2xx 抛 `resend {status}: {detail}`、响应体读取失败仍保留状态码、网络错误原样上抛且 fetch 仅一次（不吞错不重试，重试/死信归调用方）；错误映射小加固（text() 失败 detail 置空）；与 E2E email-inbox/mail-flow 双端同构断言防漂移，为 B06 Web Push provider 抽象立契约样板）
59. F09 coverage branch 90% 评估（完成：基线 86.07% → 90.04%（886/984），vitest.config.ts branches 门禁 85→90；补测 email-notify.ts 边界（NEXT_PUBLIC_APP_URL 回落 localhost、profile 缺 notification_settings 兜底空对象、body/link 缺省置 null）、email-digest.ts 未知类型折叠标签回退、webhook-events repo（countWebhookEvents 成功/count null 回落 0/出错抛错、upsert payload 透传、listRecent data null 回落空数组）；4 项阈值 stmts 95.44/branch 90.04/func 96.51/lines 96.17 全过）
60. F10 CI artifact/coverage 告警清理（完成：`lint-and-type-check` job 的 Run tests 由 `pnpm test` 改为 `pnpm test:coverage`——CI 同步 enforce 覆盖率门禁（branches 90%），coverage/ 目录真实产出后 artifact 上传不再报空路径告警；验证 d2465a3 CI 4 job 全绿、test-coverage artifact 288KB 正常落盘、annotation 消除）

### G. UI 系统与 Tailwind（G01–G10）

61. G01 Tailwind v4 试点页迁移
62. G02 design token 收口
63. G03 shared form field 统一
64. G04 loading/empty/error 状态统一
65. G05 暗色模式回归
66. G06 移动端断点回归
67. G07 键盘与 screen reader 交互
68. G08 上传组件进度与取消
69. G09 通知中心实时刷新
70. G10 视觉回归基线

### H. 数据库与安全（H01–H10）

71. H01 Web Push migration
72. H02 upload metadata migration
73. H03 RLS 全表回归
74. H04 service-role 最小权限审计
75. H05 storage policy 审计
76. H06 webhook 幂等约束
77. H07 审计日志索引复审
78. H08 数据保留与删除策略
79. H09 migration drift 检查
80. H10 依赖与 secrets 扫描门禁

### I. 文档、发布与开发体验（I01–I10）

81. I01 docs-site 邮件章节同步
82. I02 docs-site OSS 章节同步
83. I03 docs-site Web Push 章节同步
84. I04 ADR 更新与决策状态
85. I05 CHANGELOG 自动校验
86. I06 release checklist v0.6.0
87. I07 本地 mock 开发指南
88. I08 provider 配置诊断指南
89. I09 贡献者测试矩阵
90. I10 迁移回滚 runbook

### J. 质量与发布（J01–J10）

91. J01 lint/type-check/test/build 全链路门禁
92. J02 E2E shard/串行策略复审
93. J03 CI 并行与缓存优化
94. J04 CodeQL 告警零回归
95. J05 Secrets Scan 零回归
96. J06 production smoke test
97. J07 tag/release 自动化
98. J08 发布后回滚演练
99. J09 v0.6.0 退出报告
100.  J10 v0.7.0 候选池评审

## 里程碑

| 里程碑            | 内容                               | 任务域  |
| ----------------- | ---------------------------------- | ------- |
| M1 安全与测试基建 | Mock 隔离、MFA、RLS、E2E 稳定性    | C、F、H |
| M2 上传与通知     | OSS 上传、Web Push、统一偏好与回执 | A、B、G |
| M3 质量与观测     | 多语言/a11y、指标、告警、runbook   | D、E    |
| M4 发布收口       | docs-site、CI、smoke、tag/release  | I、J    |

## 退出标准

1. `pnpm verify:build`、`pnpm test:e2e` 全绿，且覆盖率 branches 不低于 90%。
2. CI、CodeQL、Secrets Scan 全绿，生产依赖无高危漏洞。
3. Mock 测试可显式 reset，E2E 不依赖不可控的跨用例共享状态。
4. 上传、通知、MFA 关键路径均有失败/重试/权限边界测试。
5. 数据库迁移、RLS、发布清单与 docs-site 章节同步完成。
6. 发布后 smoke 与回滚 runbook 已演练并记录结果。
