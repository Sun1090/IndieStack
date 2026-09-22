# Changelog

All notable changes to IndieStack will be documented in this file.

## [Unreleased]

### Added

- **拼错的列名不再是这个仓库唯一没有门禁的数据库缺陷**（C07）：新增 `pnpm check:query-columns`，
  把 `src/**` 每条 `.from("<表>")` 查询链上的字面量列名对回 `src/lib/supabase/database.types.ts` 的 `Row`
  类型。起因见下面的 Fixed：`email_worker_runs` 一直在按一个从不存在的 `started_at` 排序，而
  `pnpm type-check` 退出 0——生成的类型只约束查询**结果**，过滤与排序参数在类型上只是字符串；单测里查询链
  是 mock 的；Mock 客户端的 `order()` 对未知列静默 no-op。四类门禁全部失明，这条错误只有打上真库才现形。
  接线前先量（D01 口径）：命中恰好 1 条，就是那条真实缺陷，误报 0。规则在 `src/lib/db/query-columns.ts`
  （TypeScript AST、纯函数、单测覆盖），IO 在 `scripts/lib/query-columns-check.js`，
  `scripts/check-query-columns.js` 只负责用 Node 原生 type stripping 跑起来。判定范围刻意收窄，但每一处收窄
  都计数并随结果打印，「范围本来就窄」和「范围被调空」在输出里一眼可分：只认字面量表名与纯标识符（视图与表在
  读侧同形，`Views` 的 `Row` 一样算合法列集合；`Row` 展不开的关系直接丢掉而不是把它的每列都判错——写第一版时
  真实类型里就有一个 `Row: Record<string, never>` 的视图踩在这条上），`*`、`metadata->>role`、`amount::text`、
  `count()` 一律跳过并计数），`select("alias:column")` 判的是冒号
  右边那一列，含关联嵌入的链整条跳过（展平关联后基表 `Row` 不再是合法寻址集合），`storage.from("avatars")`
  是桶不是表。两条失败封闭：读不出任何表报 `QUERY_TYPES_UNREADABLE`（第一版解析器把 `type Database` 读成
  0 张表，正是这条当场把它自己抓了出来），一条列名都没判报 `QUERY_COLUMN_GATE_VACUOUS`。11 项变异核对全部
  被抓（去掉两处 storage 豁免、去掉嵌入跳过、`PLAIN_COLUMN` 放开成 `/^.+$/`、拆掉别名解析、把 `select`
  移出判定集、关掉两条封闭、反转成员判断、断掉链遍历）。其中 storage 豁免第一版**逃过了变异**：一个变异脚本
  崩在中途没走到还原，把 `collectQueryFacts` 里的那处豁免静默吃掉而门禁全绿——补了一条「桶名与表名同名」
  的用例，现在它必须由那条用例红。
  CI 不需要单独接线：`ci.yml` 的静态作业跑 `pnpm check:all`（C04），新门禁进聚合入口即进 CI。
- **管理面板终于看得见邮件待发队列的形状**（A05 前半）：新增 `src/lib/notifications/queue-diagnostics.ts`
  ——纯规则，四件事：队列有多少条、最老一条卡了多久、最近有几轮「拉到东西却一封没发出去」、
  以及超过 48h（两个日调度周期）算不算卡住；admin 概览页多一张「邮件待发队列」卡片。
  先做可观测的理由写在模块头部：**在看清规模之前讨论出队语义等于猜**。偏好全关 / 无邮箱这两类
  被跳过的条目仍然永远出不了队列，本条**不改变任何发送行为**，出队语义仍待拍板。
  口径一致性是这里唯一真正要紧的东西：面板上报的年龄必须说的是 worker 那支队伍。
  `repositories/notifications.ts` 里拉取、积压计数、`oldestUnsentEmailCreatedAt()`（新增）读同一段过滤，
  但 Supabase 的查询链是逐列泛型的——`select("*")` 与 `select("id", {head:true})` 返回不同类型，
  抽成一个共享函数会把类型压成清单里的第一张表（`pnpm type-check` 当场报出来），所以三处各自写全
  四段过滤，只把最易漂移的死信条件收成常量，一致性交给 `notifications.test.ts` 一条
  「三个口径的过滤调用逐项相等」的用例。变异核对：任何一处少一段 `.eq/.in/.or`、
  或者最老一条少了 `.limit(1)`，该用例红。新增 `listRecentEmailWorkerRuns()`（默认 20 轮）读
  `email_worker_runs`；service-role 清单因此 86 → 88 个调用点（模块数不变），
  `docs/db/security-audit.md` 的快照同步。年龄分档留在纯模块里（分钟/小时/天，天档起点就是 stale
  阈值，否则会出现「显示 1 天却已经 stale」），单位词交给 `messages/{en,zh-CN}/admin.json`。
  读数拼装放在 `src/lib/notifications/queue-observability.ts` 而不是组件里：`Date.now()` 写在
  Server Component 体内会被 `react-hooks/purity` 拦下，而把它挪到模块顶层又会让年龄从进程启动起就不动。
  E2E 收口：admin 概览页种 3 条队列内类型 + 2 条队列外类型，卡片必须报 **3**，而种子端点按
  「未发送未读」回读到的是 5——两个数字不一样才是这条用例的意义，只断言「渲染了一个数」的话，
  类型列表写错、忘掉死信过滤都能照样通过。
- **Mock 客户端的 auth 表面积从此要覆盖应用真正调用的方法**：新增 `src/lib/mock/auth-surface.test.ts`，
  扫 `src/**` 里的 `<client>.auth.<路径>(` 调用点（指标名之类的字符串不算，抽取靠「必须是调用」这一形状），
  逐个对回 `new MockSupabaseClient().auth` 的真实对象形状，缺哪一段就报「哪个文件 → auth.xxx（缺 xxx）」。
  动机是 C03 撞到的那件事：挑战页 `await supabase.auth.refreshSession()`，而 mock 没这个方法，
  浏览器里就是一次 TypeError 被页面的 catch 兜成「登录失败，请稍后重试」——组件级用例把整个 client 桩掉，
  永远看不见这类缺口。两条 passkey magiclink 的 admin 方法暂时带理由挂在 `KNOWN_GAPS`，并配一条
  **反向断言**：谁把它们实现了，豁免就因「已不再是缺口」而变红，必须删行。
  它跑在 `pnpm test` 里（本来就是 push 的硬性前置），所以没有再往 `scripts/check-*` + CI +
  双语 docs-site 那套接线复制第三遍。变异核对：把 `refreshSession` 改名 → 扫描用例红并点名
  `src/app/auth/mfa/page.tsx`；把某条豁免换成已实现的方法名 → 反向断言红。
- **全量并行的 E2E 基线从此可复跑**（C02）：新增 `.github/workflows/e2e-parallel.yml`，用
  `PW_FULLY_PARALLEL=true` 跑**全量** E2E（刻意不带 `--shard`），
  手动 `workflow_dispatch` 与每周一 `30 7 * * 1`（07:30 UTC）各一次，并强制 `--retries=0`：
  CI 默认重跑 2 次，而重跑会换 workerIndex、也就是换一台干净的服务器——「第二次成功」说的
  已经不是同一份状态了。F04 留下的问题从来不是
  「没有并行开关」——开关一直有——而是「那句 31/31 通过是一次再也复现不了的实验」。
  这条把它变成有固定触发点、报告留档（`if: always()`，成功也留）的测量。
  最初一版是「一个 dev server 上开多 worker」，首跑就是在这个条件下量出 4 条红（见 Known
  Limitations），随后改成**一个 worker 一台 dev server**（见下面那条）。
  **它是测量，不是门禁**：不接 `pull_request`/`push`、不在必需检查里、`ci.yml` 也不依赖它；
  变红的含义是「按报告记下哪一份共享状态冲突」，禁止为了让它绿而把 mock 的运行时默认 store
  改成请求级。默认 CI 的 shard 各自独立 dev server、内部单 worker，本来就测不出并发冲突，
  两套互补。`src/lib/testing/e2e-shard-policy.test.ts` 钉住这些性质，并把 #68 的教训推广成一条
  通用规则：**全仓库任意两个作业不得写同名 artifact**（变异核对：删 `PW_FULLY_PARALLEL` 环境、
  加 `pull_request` 触发、把 `pnpm test:e2e` 改成带 `--shard`、把 artifact 名改成与 ci.yml 重名，
  分别让对应断言变红）。
- **并行 E2E 的隔离边界落在 worker 上**（C02 第二半）：`PW_FULLY_PARALLEL=true` 现在按
  `E2E_SERVERS` 起**同样数量**的 dev server，`workers` 取同一个值，即一个 worker 一台服务器。
  共享默认 store 是刻意的（假数据库，C01 已论证不能改成请求级），所以进程级的状态只能靠进程边界隔离。
  `next dev` 用 `<distDir>/dev/lock` 判断「这个工作副本已经有一个 dev server」，同一份源码起第二台会
  直接退出 1，因此 `next.config.ts` 支持 `NEXT_DIST_DIR`，每台服务器用 `.next-e2e-<slot>`——名字按
  slot 而不是端口编，否则每换一个 `E2E_BASE_PORT` 都会让 Next 往 `tsconfig.json` 追加一组新路径，
  而它写进去的不会自己回收。配套：spec 里的应用地址统一走 `e2e/support/base-url.ts` 的 `appUrl()`
  （按 `TEST_WORKER_INDEX` 选端口），50 处 `${APP_URL}` 与 58 处裸相对 `page.goto` 清完；
  `waitForURL("**/…")`、`page.route("**/…")` 这类与端口无关的 glob 保持相对形式。
  两条新契约由 `e2e-shard-policy` 钉住：`workers` 必须等于服务器数；spec 里不得出现 `localhost:3100`
  或裸相对 `page.goto`。附带收益：本机 3100 被别的项目占用时，`E2E_BASE_PORT=3101 pnpm test:e2e`
  就能跑，不用改任何被测文件。
  清零共享冲突后又红过两轮（106/107、105/107），红的是三条各不相同的用例，共同点只有一个：它们都是
  **第一个打到某台服务器的用例**，在付 `next dev` 的按路由冷编译。因此加了一步 `globalSetup` 预热
  （`e2e/support/warm-up.ts`，只在 `E2E_SERVERS>1` 时生效，串行 CI 一秒不多花）。第三轮
  run `35746785602` **107 passed / 0 failed**——全量并行第一次有绿的可复跑记录，而且整条路上
  既没有动 mock 的状态模型，也没有放宽任何断言。
- **文档里的调度事实从此要对得上仓库**（D01）：`pnpm check:cron-contract` 多一条规则，扫
  `docs-site/**` 与 `docs/**`（带日期的快照除外：发布页、runbook、roadmap 记录的是当时的事实，
  改它们等于伪造证据），把合法的 5 字段 cron 表达式与 `/api/cron/*` 路径逐个对回
  「worker 注册表 ∪ `vercel.json` ∪ GitHub workflow 的 `schedule`」。文档教一条仓库里不存在的调度
  报 `CRON_DOC_STALE_SCHEDULE`（`docs-site/web-push.md` 那条「每 15 分钟」就是这一类），提到一条
  没人调度的路由报 `CRON_DOC_UNREGISTERED_PATH`（E03 那次 digest 从未被调度就是这个形状），
  一篇文档都没收集到则报 `CRON_DOC_NO_SOURCES` 失败封闭。cron 表达式的抽取与 D02 共用同一个函数，
  两条门禁看到的才是同一件事：**D02 管中英两边说同一件事，D01 管它们说的是不是代码里的那件事**。
  接线时先量后写：一次性核对 84 篇文档，另有一版「文档提到 worker 路径就必须登记其调度」的更强子规则
  当场产出 8 条**合法**陈述的告警（`web-push.md` 只是顺带引用 digest），说明它会把散文式引用全误伤，
  因此删掉——门禁的命中率比严格度重要。
新增 `docs/operations/release-audit-template.md`，把 v0.6.0
  退出报告里那套「逐条对回代码、门禁与执行记录」的做法写成可复用规则——三档状态各自需要什么证据、
  「文档已写」不算证据、每条门禁都要做一次「故意做坏会不会红」的变异核对、版本范围由 CHANGELOG
  章节生成而不是凭记忆写散文，以及四件容易互相冒充的事：代码合并 ≠ 已部署、生产跑新版本 ≠ 已发布、
  本地真库演练 ≠ 云端演练、门禁全绿 ≠ 生产证据齐全。同时补上断档的系列文件
  `docs/operations/release-gap-audit-v0.11.0.md`，它量出三处口径问题（runbook 声称范围内有 5 项
  其实更早就完成、J06 只完成一半、整个 D 域交付了却没写进范围段），并把「本版本缺口审计已按模板产出」
  加进 `.github/RELEASE_CHECKLIST.md` 的冻结清单——`check:release-docs` 按版本拼路径校验，
  本来就管不到这个系列是否存在，断档只能靠把动作写进清单来防。
- **生产现在会说自己跑的是哪个 commit**：`/api/health` 新增 `commit` 字段，取自构建时内联的
  `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`（Vercel 自动提供），回落到运行时的 `VERCEL_GIT_COMMIT_SHA`，
  两者都没有时为 `null`。此前 `version` 只能说明「这是 0.11.0 的某个构建」，说明不了是哪一个，
  而发布 runbook 的停止条件恰好写着「无法证明部署 commit 与验证 commit 相同」——同一个版本号里
  夹了几个纯文档提交，从外部看完全一样，于是这条证据只能靠平台控制台的人工截图。
  `pnpm smoke:production` 相应支持 `--expected-commit`（短 SHA 按前缀匹配，`EXPECTED_APP_COMMIT`
  为等价环境变量）：**期望值给了而生产不上报 `commit` 就判失败**，因为「没证明」不等于「证明了自己没问题」；
  期望值少于 7 个字符直接拒绝解析，否则任何构建都能匹配上。每日定时的 `smoke-main` 只把观测到的
  commit 写进证据、不做断言——两次部署之间生产落后于 `main` 是常态，硬断言会让定时作业红在无关的事上。
  路由测试覆盖「内联值优先 / 只有运行时值 / 两者皆无」，冒烟测试覆盖「全 SHA、短前缀、不匹配、
  生产不上报」四种组合。
- **双语页从此必须说同一个调度事实**：新增 `pnpm check:bilingual-docs`
  （规则本体 `src/lib/docs/bilingual-facts.ts`，IO `scripts/lib/bilingual-docs-check.js`，
  已接进 `check:all` 与 CI）。逐页比对 `docs-site/<page>.md` 与 `docs-site/zh-CN/<page>.md`
  里可机器核对的**结构化调度事实**——5 字段 cron 表达式与 `HH:MM UTC` 时刻；两边集合必须完全相等，
  「一边提到一边没有」同样失败，因为只改一种语言正是漂移的发生方式。cron 合法性复用
  `isValidCronSchedule`，避免把散文里的数字串当成表达式；找不到配对、英文页缺中文同名页、
  文档内容为空都是失败封闭（`DOC_NO_PAIRS` / `DOC_PAIR_MISSING` / `DOC_SOURCE_EMPTY`）。
  规则 13 条 + IO 6 条；变异核对：把中文版 `0 9 * * *` 改成 `0 5 * * *` →
  `❌ [DOC_CRON_MISMATCH] docs-site/email.md cron 表达式与中文版不一致：缺少 0 9 * * *；多出 0 5 * * *`。
  接线时核对面：27 对文档 / 7 个 cron 表达式 / 3 个 UTC 时刻（数量以命令输出为准，文档不复述）。
- **「按用户条件跳过投递」从此必须有计数，否则 PR 就红**：新增
  `src/lib/observability/cron-skip-coverage.ts`，用 TypeScript 解析器核对每个 cron worker 路由里
  **带条件的 `continue`** 是否留下计数证据——上报该 worker 注册过的 skip 指标（且带 `reason` 维度），
  或累加进本轮已上报的计数器（发送失败走的就是 `failed`）。接进 `pnpm check:cron-contract`，
  注册表因此多出 `skipMetrics` 字段（必须是 `metrics` 的子集，否则 `CRON_SKIP_METRIC_UNDECLARED`），
  成功日志也自报「N 处条件跳过均有计数证据」，让「核对过多少条」本身可见。
  动机就是下面那条 digest P0：跳过不计数时，一轮在指标上表现为 `pulled=N, sent=0, failed=0` 的
  「成功」，静态类型和普通单测都拦不住。配套实现：`/api/cron/digest` 的两处跳过
  （资料无邮箱 / 用户关掉涉及类型）现在上报 `cron.digest.skipped{reason=no_email|preference}`，
  条数按用户上报、告警侧按 `reason` 拆分（`sentry-alerts.md` 登记指标、整轮未发出的判定规则与
  去重说明）。变异核对：删掉那条 `recordMetric` → `CRON_SKIP_UNCOUNTED`；去掉 `reason` →
  `CRON_SKIP_REASON_MISSING`；规则单测另覆盖「指标没登记」「源码无法解析」与「无条件 continue 不判」。
- **客户端包体积基线从此 CI 也会拦**：`check:bundle` 的 package.json 命令自带一次
  `pnpm build`，在 CI 里照抄就是再等 20 分钟，因此它此前只在本地 `pnpm verify:build` 与 pre-push
  生效——CI 的 `Build` job 只跑了 `check:perf`（另一组断言），依赖膨胀要等谁在本地跑全量验证才看得见。
  脚本本身只读 `.next/static`，于是 `Build` job 在 `pnpm build` 之后直接
  `node scripts/check-bundle.js` 复用同一份产物。`check:gates` 原先只认「`pnpm <gate>`」或整条原始
  命令，现扩展为**也认实现脚本被直接调用**（按 `scripts/*.js` 路径匹配，出现别的脚本不算接线），
  那条已经不再成立的 CI 豁免理由随之删除。
- **v0.6.0 退出报告（J09）与 v0.12.0 候选池（J10）**：`docs/operations/release-exit-report-v0.6.0.md`
  把 roadmap 的 100 项任务与 6 条退出标准逐条对回代码、门禁与执行记录（首次核对 89 达成 /
  9 部分达成 / 2 未达成，未达成是 F01 与 J08），核对过程中发现摘要邮件因错峰门控与每天一次的调度不兼容而对
  除 UTC-1 外所有用户不投递（该门控已于同日按产品决策移除，见下面的定案条目）；
  `docs/roadmap-0.12.0.md` 的 20 项全部来自这些部分/未达成项与生产证据缺口。
- **保留期终于有了执行者：`/api/cron/retention`（每天 05:00 UTC）**。迁移 `003` / `014` / `027` / `032`
  里的 6 个 `security definer` 清理函数此前只注册在 pg_cron 上，而那段调度写成
  `if exists (select 1 from pg_extension where extname = 'pg_cron')`——本地与云端项目都没装 pg_cron，
  于是迁移成功、门禁全绿、`/api/health` 正常，却一行都不会删。新 worker 用 service_role 逐个调用
  **同一批迁移函数**，删除逻辑仍然只有迁移 SQL 一个事实源；日后启用 pg_cron 也只是两条链路跑同一个
  `now() - <retention>` 条件，幂等。逐个顺序执行而不是并发：这些都是全表范围删除，
  在免费层实例上同时压六个只会互相等锁。单表失败只上报
  `cron.retention.cleanup_failed{cleanup_function}` 并继续下一张，**全部失败才让整轮返回 500**——
  否则平台调度记录显示成功，而过期数据一直在堆积。调度与指标登记在
  `src/lib/observability/cron-contract.ts`，由 `pnpm check:cron-contract` 校验（登记了没调度、
  调度了没登记、指标没写进告警文档都会失败）；`src/lib/repositories/retention.test.ts` 把清理清单与
  `RETENTION_POLICIES` 双向钉死，新增保留策略忘记接调度会直接失败。service-role 边界相应扩大到
  32 个模块 / 86 个调用点 / 10 个 RPC，已在 `docs/db/security-audit.md` 与清单里登记
  （该条目写就时是 87 个调用点，随 digest 门控删除 `/api/e2e/profile-timezone` 后为 86）。
- **孤儿巡检不再只靠人记得跑**：`/api/cron/retention` 每轮顺带调用一次 `find_orphan_upload_objects()`，
  产出 `storage.orphan.objects` 与 `storage.orphan.unowned` 两个计数——后者就是「上传者账户已删除、
  对象还在 bucket 里公开可读」的隐私面。033 与 `erasure.ts` 的注释一直写着失败删除「可被发现并补删」，
  但那之前只有一个人手动的 `pnpm audit:storage-orphans`，没人跑就等于没这条链路；完整清单仍由该命令提供。
  巡检是只读的，失败既不拖垮保留期那一轮，也不会被报成「零孤儿」：响应里 `orphans` 为 `null`，
  且 `cron.retention.completed` 干脆不带 `orphans` 维度——缺失才是真的缺失。
- **保留期清理的真实数据库演练**：`docs/operations/drills/retention-cleanup.sql`（沿用
  `account-erasure.sql` 的约定，`begin; … rollback;` 全程不留数据）。worker 与单测都只证明
  「函数被调用」，mock 从不碰真实 SQL，而保留期真正会错的地方就在 SQL 里：窗口边界差一天，
  要么隐私承诺失真，要么用户数据被静默删掉，两种都不会让门禁变红。脚本对 6 个函数各测
  「窗口两侧 + 受保护状态」，边界刻意取差一天（90/91、29/30、364/365）而不是差一年——
  后者任何实现都能蒙对。本地 Supabase（`001`–`033`）实测 14 条断言全通过，结果记在
  `docs/db/retention.md` 的演练记录里。同一份记录还有一次**关掉 mock** 的整链路验证：用本地栈凭据起
  dev server、真实播种两条行（91 天 / 89 天）后打 `POST /api/cron/retention`，得到
  `{"ran":6,"failed":0,…}`、91 天那条消失、89 天那条留下，未携带与错误凭据各自 401。
  失败路径同样在真库里演练过：收回 `cleanup_old_api_usage()` 的 `EXECUTE` 后整轮返回
  `{"ran":5,"failed":1,…}`（HTTP 仍是 200），另两张表的过期行照常删除，恢复授权后下一轮把残留那条补删掉，
  且 `cron.retention.cleanup_failed{cleanup_function}` 与 `permission denied` 日志都真实落到了输出里。

### Changed

- **CI 的静态门禁与本地聚合从此只有一份清单**（C04 的剩余部分）：`ci.yml` 的 `Lint & Type Check` job
  过去逐个写 30 步 `pnpm check:*`，与 `scripts/check-all.sh` 是两份各自手工维护的清单——历史上确实
  出现过「只在本地聚合里有」和「只在 CI 里有」的门禁（`check:gates` 就是为这件事存在的）。现在那 30 步
  换成一步 `pnpm check:all`。**接线审计在这一步上原本是空的，是变异核对把它照出来的**：把
  `pnpm check:all` 从 `ci.yml` 删掉，`check:gates` 仍然全绿——它按「任意 workflow」判定接线，
  而 `release.yml` 同样跑聚合，于是「CI 在跑一份清单」这个前提可以由一个只在打标签时才执行的工作流
  满足，PR 上门禁却一道都不跑。规则因此搬进 CI 拓扑门禁（`check:workflows`）：**静态作业正文里必须
  出现 `pnpm check:all`**，删掉即 `CI_TOPOLOGY_DRIFT`，且逐个写 `check:*` 不能替代它。
  作业名 `Lint & Type Check` 一字未改——分支保护的必需检查按名字匹配，改它属于改动共享配置。
  代价两条，都记下：CI 界面少了一层「哪一步红了」，靠聚合脚本每步前的 `==> <门禁>` 与出错时补的
  `❌ 门禁失败：<命令>` 找回来；单测在本 job 与 `Unit Tests`（覆盖率）各跑一次，多花约一分钟，
  换两处的判定完全同源。

### Fixed

- **digest 一轮里已经寄出去的邮件不再被记成一封没发**：`runDigest` 把 `markEmailSent`（以及失败分支的
  `recordEmailFailures`）写在裸的位置上，回执写入一抛就从整轮抛穿出去，落到 `POST` 的 catch 里记一条
  `recordFailedRun(startedAt, error, pulled)`——而该函数当时把 `sent / groups / failed` 写死成 `0`。
  于是**一轮已经给若干用户真的寄出摘要**的运行，在 `email_worker_runs` 里表现为「拉到 N 条、0 封发出、
  0 封失败」，正好命中 A05 面板「空发送轮次」的定义（`pulled>0 && sent===0 && failed===0`）：看板不是
  漏看了一轮失败，而是**教人相信一个假信号**——那比看不见更糟。现在进度就地累加在调用方持有的
  `DigestProgress` 上，`sent` 在 provider 收下那封信时就先加（回执写不写得动都不改变「寄出去了」），
  抛穿的轮次照实记下当时的 `pulled / sent / groups / failed`。
  两处回执各自包一个 `try` 并新增指标 `cron.digest.receipt_failed{stage}`：`stage="sent"` 是「信已发出、
  发送回执没写进去」，那一行仍留在队列里，下一轮可能给同一用户再寄一封（at-least-once 的既有代价）；
  `stage="retry"` 是「发送失败**且** `email_attempts` 的增量没写进去」，重试计数冻结。邮件侧刻意**没有**
  照搬 Push 的行龄上界（上一条那个 `max-age`）：丢掉一封排了 N 天的信改变的是送达语义，属于 A05 待拍板
  的产品决策，不在修日志诚实度的这一步里顺手替用户决定。指标注册表 15 → 16，由
  `pnpm check:cron-contract` 与 `docs/operations/sentry-alerts.md` 同时登记。
  新增 3 条用例（该文件 18 条）：一条打桩方式值得记下——整模块 `vi.mock("@/lib/email-template")` 会把
  另一条断言**真实折叠 HTML** 的用例一起弄红，所以换成 `importOriginal` 透传 spy，只替 `renderEmailHtml`。
  变异核对 8 项全部被抓（回执退回裸调用、`sent` 挪回回执之后、`recordFailedRun` 退回写死 0、
  两个 `stage` 维度写死或删掉、删指标、删日志、把 `failed` 累加挪进内层 `try`）。
- **`check:cron-contract` 从此要求指标真的占一行**：上一条在改告警文档时，一次编辑把
  `docs/operations/sentry-alerts.md` 里 `cron.digest.failed` 的**表行整行删掉**了，而全部门禁绿灯——因为该规则
  判的是「指标名在文档里出现过」，那个名字同时还躺在调度表和告警规则表里。这正是 C04 学过的形状：
  「集合里某处存在」不是不变量。现在 `documentsMetric()` 只认表行首格（反引号可选），报错文案改成
  「指标表里没有 X 那一行」。收紧前先量：注册表 16 个指标在真实文档里都已有表行，所以当前仓库仍绿；
  变异核对 = 删掉 `cron.digest.failed` 那一行 → 门禁红并点名该指标（旧规则下同一变异是绿的）。
  规则侧 2 条新用例：一条把指标只写在散文里，必须红；一条把整张表改成带反引号的写法，必须绿
  （不给探测器一个它必须标的输入，就等于没测）。
- **「全部已读」失败不再长得像成功**：`repositories/notifications.ts` 的 `countUnreadNotifications()`
  与 `markAllNotificationsRead()` 只取 `{count}` / `{data}`，把 `error` 丢掉后返回 `count ?? 0` /
  `data?.length ?? 0`——一次数据库故障因此读成「0 条未读」（角标消失、按钮根本不渲染），而批量标记失败
  返回的 `0` 既可能是「确实没有未读」也可能是「一条都没改成」。同文件的 `listRecentNotifications()`
  早就写了规矩（「查询失败抛错，不再吞错回空数组」）、`markNotificationRead()` 也照做，只有这两条没有。
  现在两者都抛错。Server Action 那层早就有 `try/catch → fail("databaseError")`，Action 测试也覆盖了
  拒绝路径——只是仓库永远不抛，那条分支从来没被真实触发过，所以「已有兜底」是纸面上的。
  前端一并补上：`MarkAllReadButton` 过去在 `result.ok === false` 时什么都不做，用户看到的就是
  「点了、没反应」，只能反复点；现在与 `RemoveMemberButton` 等组件同规矩地弹 destructive toast
  （复用 `common.error` + `actions.databaseError`，不新增文案）。
  仓库 2 条 + 组件 3 条新用例（该组件此前零覆盖）；变异核对 4 项全部被抓（两处退回吞错、删掉失败
  `else` 分支、把成功提示也改成 destructive），源文件逐字节还原。
- **Push 重试从此有一道写失败也拖不上的上界**：`push-retry.ts` 的终止条件只有
  `attempt_count >= PUSH_MAX_ATTEMPTS`，而这个计数器**只有在重排回执写成功时才会前进**。
  `markPushDeliveryRetry` 抛错时旧代码只 `reportError` 一句然后照样 `return "retried"`——行仍是
  `pending`、`next_attempt_at` 停在过去的时刻、计数冻结，于是下一轮它又被按 `next_attempt_at` 升序
  拉到队首，永远到不了上限：一行毒记录可以无限期占住单轮 50 条的预算，而看板上看起来「一切正常地在重试」。
  现在补上绝对上界 `PUSH_RETRY_MAX_AGE_MS`（7 天）：超龄的行写 `dead`/`failure_code=max-age`，判定只认
  `created_at`（入队时定死、写失败动不了它），`created_at` 解析不出来时按未超时处理，宁可不收紧也不把
  还能送的行判死。取 7 天而不是「退避总和」：worker 每天 22:00 UTC 才跑一轮，健康路径上 3 次尝试本来就要
  跨三天。回执写失败也不再静默：新增 `push.delivery.retry_failed`（`reason` 是那次投递失败的原因），
  日志文案改成明确说「行仍待下一轮，退避与计数未推进」，并与「已安排重试」互斥。
  变异核对 10 项全部被抓（去掉年龄判定、恒判超时、NaN 判超时、把上界错写成退避封顶、
  `max-age` 降级回 `max-attempts`、不报指标、指标维度写死、日志文案改回含糊、catch 里不再 return、
  整段退回旧写法）；新增的 E2E 用例在移除年龄判定后确实变红（串行模式下该条一红即停），
  规则文件与备份逐字节比对后恢复。
- **worker 运行记录不再按一个根本不存在的列排序**：`/api/e2e/email-worker-runs` 用
  `.order("started_at", { ascending: false })` 读 `email_worker_runs`，而这张表从建表（迁移 017）起就只有
  `created_at`（还专门建了 `created_at desc` 索引）。Mock 客户端对未知排序列静默 no-op，而 mock store 的插入
  顺序恰好让 `runs[0]` 仍是最新一轮，于是这条链从来没有被真正验证过——接上真库它就是一次 400。改为
  `created_at` 后 `pnpm test:e2e e2e/mail-flow.spec.ts` 3/3 仍绿；这条列名由新门禁 C07
  `pnpm check:query-columns` 永久钉住（见上面的 Added）。
- **实时邮件「已经发出去」不再被记成「发送失败、留待 cron 重试」**：`email-notify.ts` 把
  `markEmailSent` 写在和 `sendResendEmail` 同一个 `try` 里，于是**回执写入**失败也会落进
  「发送失败（留待 cron 重试）」那条 catch——邮件其实已经在 provider 那里落地，日志却把人往
  「没发出去」的方向带；而队列里的行确实仍是待发，下一轮 digest 会再寄一封。重复投递本身是
  at-least-once 的既有代价（`push-retry.ts` 的成功分支早就是这个形状：发送与回执各一个 `try`），
  这次修的是**那句说谎的话**：发送失败的 catch 只覆盖发出去之前，回执失败单独上报
  「邮件已发出，但发送回执写入失败（下一轮摘要可能重复寄出）」。新用例断言的是这两条文案**互斥**；
  变异核对：把 `markEmailSent` 塞回原来的 `try`，该用例红。
- **digest 失败轮次的运行记录从此是真实数字**：`recordFailedRun` 原本写死 `pulled: 0`，
  「拉到 100 条然后整轮抛错」那一类——正是队列头部压得最狠的一类——在 `email_worker_runs` 里表现为
  「什么都没拉到」，因而永远进不了 A05 的「空发送轮次」（只数 `pulled>0 && sent===0 && failed===0`）。
  现在把计数提到 `try` 外面、失败时带真实值。同一处还修了失败原因被丢掉：`getProfiles` 抛的是
  PostgREST 的错误对象而不是 `Error` 实例，`error instanceof Error ? error.message : String(error)`
  只会得到 `"[object Object]"`，这张表存在的全部理由（看得出 worker 到底失败成什么）就此落空；
  改成 `failureText()` 认三种形状（`Error` / 带 `message` 的对象 / 其余回落 `String()`）。
  三条变异核对——记回 `pulled: 0`、不 hoist 计数、换回 Error-only 抽取——分别让对应用例红。

- **两条 E2E 其实一直在共用第一台 dev server**：`a11y.spec.ts` 的 `page.goto(pageInfo.path)`、
  `smoke.spec.ts` / `responsive.spec.ts` 的 `page.goto(path)`，加上 5 处 `request.get("/…")`，
  都不带 `appUrl()` 而靠 Playwright 的 `baseURL` 解析——`baseURL` 写死的是基准端口，于是并行时
  第二个 worker 的无障碍审计和冒烟请求全打回 slot 0。C02 那条「不得出现裸相对 `page.goto`」
  按字面量 `"/` 与反引号匹配，正好放过「路径装在变量里」这种写法：规则看着是绿的，隔离只剩形式。
  现在逐行看调用点——`page.goto(` 与 `request.get|post|put|delete(` 都必须带 `appUrl()`。
  变异核对：临时塞进变量式 goto、裸相对 request、裸相对字面量、写死 `localhost:3100` 四种各让门禁红，
  带 `appUrl()` 的对照组保持绿。
- **Mock 模式下 MFA 挑战根本走不完，而且第一步就进不去**（C03）：三处缺口一次性补上，全部由
  新增的 `e2e/mfa-challenge.spec.ts` 钉住（真走一遍：登录 → 挑战页 → 错码不困住用户 → 正确码进
  dashboard）。① mock 的 `auth.signInWithPassword` 不返回 `user.factors`（真实 Supabase 返回），
  而 `login-form.tsx:86` 正是读这个字段决定要不要跳 `/auth/mfa`——mock 下这条分支永远走不到；
  ② 挑战页在 verify 成功后 `await supabase.auth.refreshSession()`，而 mock 客户端**没有这个方法**，
  于是「验证码明明对了，页面却报通用登录失败」；③ 浏览器侧的 mock store 挂在 `window` 上、整页导航
  即重置，`/api/e2e/*` 那套服务端端点种不到它，种子改由 `page.addInitScript` 在页面脚本之前写入。
  组件级用例把整个 Supabase client 桩掉，①② 在那一层是不可见的——只有真跑 mock 客户端的 E2E 撞得到。
  变异核对：把 `factors` 摘掉，E2E 停在跳挑战页那一步（另两条不受影响）；`refreshSession` 缺失时
  第三条用例在进 dashboard 前超时；mock 侧「返回副本」那半在去掉 `{...factor}` 后变红。
  同一次扫描（见上面的 Added）又量出四处同类缺口，一并补齐：`auth.resend`、`auth.verifyOtp`
  （passkey 会话签发要读 `user.factors`）、`auth.exchangeCodeForSession`，以及
  `auth.admin.mfa.listFactors/deleteFactor`——恢复码自救要先列出再删除 TOTP 因子，缺这段就是
  「兑换明明成功、随后就报错」。
- **`Production Smoke` 的手动作业每天在空参数上失败，而该红的检查其实是绿的**：workflow 的 `on:`
  同时声明 `workflow_dispatch` 与 `schedule`，触发器作用于**所有**作业，但手动 `smoke` 作业的生产 URL
  与超时取自 `inputs.*`——定时触发时 `inputs` 为空，于是它每天以 `Error: --timeout-ms requires a value`
  崩溃、从未访问过生产（2026-09-21T07:56Z 与 2026-09-22T07:41Z 两份日志完全一致），
  而真正在报告版本漂移的是另一个作业 `smoke-main`，它当时已经因为生产部署了 `0.11.0` 而变绿。
  红色作业与它一起出现，等于把「Production Smoke 失败」这句话变成没有指向的信号。
  现在手动作业带 `if: github.event_name == 'workflow_dispatch'`，并新增两条契约规则把它钉住：
  读取 `inputs.` 却没有作业级 `if:` 排除 schedule → `SMOKE_MANUAL_TRIGGER_GUARD_MISSING`；
  每个作业的证据 artifact 名必须等于契约里的自己的名字 → `SMOKE_ARTIFACT_NAME_DRIFT`
  （此前两个作业都上传成 `production-smoke-evidence`，一次 `workflow_dispatch` 会留下两份
  `production-smoke.json`，实测 `gh run download -n production-smoke-evidence` 只保留后落地的那一份，
  发布记录里的「artifact 指纹」因此不确定属于哪一轮）。四项变异核对：删掉 `if:` 行、把 `if:` 改成
  `'schedule'`、删掉 artifact 名、把定时作业改回同名，均使 `pnpm check:production-smoke` 退出 1。
- **文档不再复述会过期的数字（D04）**：`docs/testing.md` 里几处「某个规则文件有多少条单测」
  全部改为「纯函数，单测覆盖」，并把「本文不写用例条数」这条约定显式扩展到局部计数；
  覆盖率阈值不再抄在文档里（改指 `vitest.config.ts` 与 `pnpm test:coverage` 的输出）。同一次扫描里发现两处**已经错了**的陈述：`docs/testing.md` 与
  `docs/db/security-audit.md` 的 `supabase db reset` 示例注释还写着「25 个迁移」，
  而仓库当时有 33 个——正是这类数字的必然结局。`docs/db/security-audit.md` 的门禁状态段
  改为列类别、不列数量，并标明 service-role 清点表是会过期的快照、以门禁输出与清单文件为准。
  历史版本页、roadmap 与退出/演练记录里的数字**保留**：那些是带日期的证据，不是当前断言。
- **英文版仍在教一种平台不允许的调度**：`docs-site/web-push.md` 写着
  `/api/cron/push-retry`「scheduled every 15 minutes in `vercel.json`」，而该表达式在
  2026-09-21（PR #32）就被改成 `0 22 * * *`——Hobby plan 每个路径每天最多一次，`*/15 * * * *`
  如今会被平台拒绝部署。按代码事实改写，并给中文版补上 `0 22 * * *`（它此前只写「每天 22:00 UTC」，
  两边引用粒度不同）。`docs-site/v0.8.0.md` 双语同样对齐：历史发布页保留 v0.8.0 当时的
  「每 15 分钟」事实，但两边都加同一条带日期勘误，说明现行调度与它为何不同。
  这三处都是新门禁 `pnpm check:bilingual-docs` 接线时当场量出来的存量漂移。
- **MFA 挑战页在请求抛异常时把用户永久卡在 `...`**：`src/app/auth/mfa/page.tsx` 的
  `handleSubmit` / `handleRedeem` 只在「返回 error 对象」的分支里复位 `loading`，而 supabase-js
  在断网或服务端错误时是**抛异常**、Server Action 也可能 reject——异常直接绕过 `setLoading(false)`，
  按钮永远停在 `...`、页面不给任何提示，用户只能刷新。两条路径改为
  `try { … } catch { 通用 authError 提示 } finally { setLoading(false) }`。
  顺带补上这个页面此前的**零自动化覆盖**：`src/app/auth/mfa/page.test.tsx` 13 条，覆盖缺 `factor`
  参数、非数字剔除与 6 位提交门控、challenge/verify 失败与成功（含 `refreshSession` +
  `auth.mfa_verified` 审计 + 消毒后的跳转）、`?redirect=` 的站外与协议相对回落、恢复码自救分支
  与两条异常兜底。变异核对：把生产代码还原成修复前写法，恰好那两条异常用例变红。
- **摘要邮件「已调度但从不投递」从此可见**：`/api/cron/digest` 的错峰门控 `isDigestHour` 要求用户的
  **本地小时恰好等于 8**，而 `vercel.json` 在 Hobby plan 下只能每天跑一次（`0 9 * * *`）。一个固定的
  UTC 时刻只落在一个时区带（UTC-1）的本地 08:00 窗口里——上海、东京、伦敦、纽约、洛杉矶的用户
  每一天都被跳过，通知永远停在「已拉取、从不发送」。实测 `2026-09-22T09:00:00Z` 各时区本地小时：
  上海 17、东京 18、伦敦 10、纽约 5、洛杉矶 2，只有 `Atlantic/Cape_Verde` 是 8。
  这条路由此前只在「整轮抛异常」时才失败，跳过分支连计数都没有，所以看板上表现为每轮
  `pulled=N, sent=0, groups=0, failed=0` 的正常成功。现在每轮上报 `cron.digest.deferred`
  （被窗口跳过的条数）并进入 `cron.digest.completed` 维度，告警文档登记「拉到了却没发出去」的规则，
  `e2e/mail-flow.spec.ts` 在强制门控下断言该计数为 0。**投递语义本身怎么改（放宽窗口 / 按时区带加调度 /
  接外部逐小时调度器）是产品决策，未在本次改动**，已写入退出报告遗留项。
  同时纠正 `docs-site/email.md` 与中文版：两份文档都还写着「仓库里的 Vercel cron 没有调度 digest 路由」
  （E03 之后已经不成立），英文版更声称可以逐小时外部调度，与 zh 版写的每天 09:00 UTC 直接互斥。
  （该窗口本身已于同日按产品决策移除，见下条；`cron.digest.deferred` 随之删除。）
- **摘要邮件不再要求「用户本地恰好 08:00」才发送**：`isDigestHour` 与 `DIGEST_LOCAL_HOUR` /
  `DIGEST_DEFAULT_TIMEZONE` 一并删除，digest 的语义变成**每轮每人一封、固定 09:00 UTC 送达**，
  不再随用户时区。这是退出报告核对出的 P0 的定案：Hobby plan 每路径每天只能调度一次，
  任何「贴着本地早晨」的门控都只会把除一个时区带外的所有人永久挡在队列里——放宽窗口
  （而不是加调度）是本次选择，代价是发送时刻不再贴合本地时区，已在双语 docs-site 与
  `docs/design/email-templates.md` 写明。配套清理：`x-e2e-force-digest` 强制头、
  从未被任何 spec 调用的 `/api/e2e/profile-timezone` 端点（service-role 调用点预算 87 → 86）、
  以及临时可见性指标 `cron.digest.deferred`（注册表回到 14 个指标）。
  回归钉子：`src/app/api/cron/digest/route.test.ts` 断言上海 / 纽约 / 圣保罗三个时区
  在同一时刻各自收到一封，门控若被写回来这条立刻失败。
- **主题切换 E2E 在 CI 上稳定失败**：`e2e/theme.spec.ts` 的「按钮切换主题」用例直接 `click()` 后断言
  `<html>` 带上 `dark`，但 E2E 跑在 `next dev` 上——首屏 HTML 和内联主题脚本早已就位，React 却可能
  还没 hydration，这一次点击因为没有监听器而被**静默丢弃**。CI 上 3 次尝试（首次 + 2 次重试）全部以
  `Received string: "light"` 结束；trace 显示点击坐标正是按钮中心、DOM 完整、控制台零报错，
  丢的是事件而不是元素，因此看起来像"产品没切换主题"。改为按项目既有惯例重试
  「先读当前状态 → 需要才点 → 断言」整体（`toggleThemeTo()`；只重试断言会把已经切好的主题再翻回去）。
  本机用 CDP `Emulation.setCPUThrottlingRate`（`rate: 25`）复现：旧写法以与 CI 完全相同的签名失败，
  新写法在同一节流下通过。`docs/testing.md` 同步补上这条 E2E 编写规则，避免下一个裸点击用例。
- **README 与 docs-site 的测试规模数字已经失真**：`pnpm test` 那行仍写着「106 files / 1,034 tests」，
  实测 **186 文件 / 2,119 用例**；docs-site 技术栈页写「270+ unit/component tests」，差约 8 倍；
  `docs/testing.md` 的金字塔写 E2E「62 用例」、shard 分流「86 条（46 / 40）」，而
  `playwright test --list` 实测 101 条 / 13 个文件，且每个 shard 的条数由 Playwright 运行时决定。
  这些数字没有任何门禁守着，每加一次测试就漂一次，所以本次**把易漂移的计数从文档里删掉**、
  改为指向 `pnpm test` 与 `pnpm exec playwright test --list`，而不是再抄一份新的当前值。
  同时把仍然存在的声明逐条对回真实来源：覆盖率阈值按 `vitest.config.ts` 改为
  statements 91 / branches 90 / functions 93 / lines 92（文档原写「≥90%」，低于实际地板）、
  v0.11.0 release notes 的 provider 环境变量 28 → 29（与 `pnpm check:provider-docs` 输出一致）、
  `docs/testing.md` 里 `gate-wiring` 28 → 29、`security-config` 无法归属的「54 条」改为按文件登记
  （31 + 5）。可核对后保留原样的有：`check:mock-docs` 的 18 张表、trace 专项「58 条」
  （11 + 5 + 3 + 18 + 6 + 15 实测吻合）、`tokens` 28 与 `native-theme` 24（均含配套 IO 层测试文件）。
- **「配额恢复」被当成「`main` 已落地生产」——三处文档的这一步推理是错的**：冒烟产物、缺口审计与
  roadmap 的 B01 行都写着生产配额恢复后 `main` 自动部署。`version=0.11.0` 只能证明「生产跑的是
  0.11.0 的某个构建」，同一版本号里之后的提交在响应上完全不可区分。用 GitHub 部署记录核到底：
  生产最后一次成功部署是 `a322a4e`（08:56:51Z），09:31Z 与 10:50Z 两次推送都被限流，
  「当前 `main` 已落地」当天其实从未成立。三处措辞已改为只陈述能证明的部分，并把「`version` 相同
  ≠ 同一个 commit」与那条不需要 Vercel 权限的取证命令写进冒烟产物与 runbook——冒烟产物原先靠
  `uptime=368s` 反推部署窗口，那是旁证，现在降级为注脚。
- **依赖审计的偶发红现在说清是网络还是仓库**：`pnpm check:security` 此前对两种完全不同的失败给
  同一条结论——`pnpm audit: report is missing metadata`。真实形状已复现确认：注册表请求失败时
  `pnpm audit --json` 退出码为 1 并打印 `{"error":{"code":"pnpm","message":"fetch failed"}}`，
  那是合法 JSON、只是没有 `metadata`，于是「网络抖了一下」读起来像「仓库配置坏了」，而正确的响应
  只是重跑（本机当天两次停在这一点，单跑与复跑都通过，CI 侧始终绿）。现在前者报
  `advisory request failed (code=…, message=…)`，后者把实际拿到的顶层键列出来。
  **两种都仍然失败封闭**，审计强度没动过一分：读不到结果不等于没有漏洞。
- **mock 里 21 个「看起来像状态」的模块级变量其实是死代码**：v0.6.0 退出报告的 F01 指着
  `src/lib/mock/index.ts` 的 `_mockMfaFactors` / `_mockMfaChallenges` 说「MFA 状态仍是进程全局」，
  顺着查下去发现这两个变量（以及同形状的另外 19 个，如 `_mockUser`、`_mockWebhookEvents`）**只被写入、
  从不被读取**——生成数据时先赋值给模块变量、再把同一份引用塞进 store，读的时候只认 store。
  它们不承载状态，只是让「进程全局」这个判断看起来有依据。本次全部删除（净 -84 行），store 自此是
  mock 状态的唯一来源。同时补齐 MFA 侧真正缺的可证伪覆盖：共享 store 的跨 client 可见性（Server
  Action 写、RSC 读的假数据库契约）、challenge 失败计数与锁定跨 store 不串、同一 store 内两个
  challenge 各自计数、`listFactors` 返回副本所以调用方改不动库。变异核对：把 MFA getter 改回读
  `MOCK_GLOBAL` → 5 条断言同时变红；去掉 `listFactors` 的拷贝 → 恰好红那一条。
  **运行时的默认 store 仍然全局共享，这是设计而不是遗留**：理由写在
  `docs/architecture/13-mock-system.md`，顺手改成请求级会重演 v0.5.0 的「写进去了、读不到」。

### Known Limitations

- **从未登记过的 bucket 对象对数据库不可见**：`find_orphan_upload_objects()` 的真相来源是
  `upload_objects`，因此只能发现「有元数据行、无业务引用」的对象；031 之前直接写入 bucket、
  从未落元数据的存量对象不在清单里，需要 provider 侧 `list()` 与数据库做集合差才能发现。
- **账户删除的不可逆面尚无自动回归**：`e2e/account-deletion.spec.ts` 只覆盖确认短语与服务端拒绝，
  不会真的删号（Mock 的 `deleteUser` 是空操作，真实提交会清空共享 Mock 状态）。
  擦除语义由 Mock 镜像与 40 条契约测试保证，「先擦除、再删号」在生产数据上的验证仍依赖
  隔离账号的一次性演练。
- **当前生产构建仍无法证明自己是哪个 commit**：`/api/health` 已经会上报 `commit`（见上面的 Added），
  但 2026-09-22 部署的这版构建早于该字段，所以 v0.11.0 的冒烟证据仍然只能给出版本号而不是 SHA。
  带该字段的构建**当天两次没能上生产**：`indie-stack` 项目在 09:31Z 与 10:50Z 各被
  `Deployment rate limited — retry in 24 hours` 挡下一次，而同一分钟的 `indie-stack-docs-site`
  部署成功——限流按项目计。生产因此停在 `a322a4e`，响应里连 `commit` 键都不存在。
  在配额放行之前，部署身份有一条不需要 Vercel 权限的权威读法：GitHub 的部署记录
  （命令见 `docs/operations/release-runbook-v0.11.0.md`）。
  下一次部署之后，`pnpm smoke:production --expected-commit "$(git rev-parse HEAD)"` 才是可用证据。
  非 Vercel 构建（本地、Docker）没有这两个环境变量，`commit` 恒为 `null`——这条链路的 commit 归属
  只在 Vercel 上成立，自建部署需要自己注入同名变量。

## [0.11.0] — 2026-09-22

### Added

- **受管对象孤儿可发现性与删号后的对象清理（A10）**：031 声称「`status='active'` 的行集合就是
  数据库认为应该存在的对象」，但 `owner_id` 是 `on delete cascade`——用户删号后元数据跟着消失，
  而他上传过的头像/封面仍在 bucket 里公开可读，于是**唯一一条「provider 删除失败」的线索恰好被级联抹掉**。
  迁移 `033_upload_object_orphan_audit.sql` 把该外键改为 `on delete set null`（列改可空），
  并新增 `upload_object_is_referenced(text)` / `list_user_objects_for_erasure(uuid)` /
  `find_orphan_upload_objects()`：引用判定用 `right(url, length(key)+1) = '/' || key` 的后缀相等而不是
  `LIKE`——对象键里的 `_` 在 `LIKE` 里是通配符，`includes` 又会把 `xavatars/u/f.png` 当成引用。
  三个函数跨行读取所有人的资料 URL，因此同为 `security definer` + 空 `search_path`、只对 `service_role` 开放。
  删号链路（`src/lib/uploads/erasure.ts`）现在会在擦除数据前清理该用户**未被任何业务行引用**的对象
  （团队项目封面等 `referenced=true` 的一律保留，删一个人的账户不应弄坏别人的页面）；
  单个对象删除失败不阻塞删号（删号是用户的权利），失败行保持 `active`、删号后归属变 `null`，
  因此会稳定出现在孤儿清单里等待补删，而不是变成看不见的泄露。账户删除审计只记计数，不记对象键（键含用户 id）。

- **账户数据擦除与保留期补齐（H08）**：隐私声明承诺「删除账户后 30 天内删除或匿名化个人数据」，
  而账户删除此前只有外键级联——`api_usage`（含 `ip_address`）与 `audit_logs` 是 `on delete set null`，
  删号只留下失去指向却仍带 PII 的行；`contact_messages` 按裸邮箱存储、根本没有外键。
  迁移 `032_data_retention_erasure.sql` 新增 `erase_user_data(uuid)`（删 API 使用记录、按邮箱删除联系内容、
  匿名化审计行：`user_id` 与指向本人的 `entity_id` 置空、`metadata` 剔除 PII 键，保留行为事实），
  以及 `cleanup_old_api_usage()`（90 天）、`prune_deleted_upload_objects()`（`deleted` 元数据 30 天）、
  `cleanup_resolved_contact_messages()`（`resolved` 满 365 天）三条保留期与两个局部索引；
  四个函数在建函数时即收回 `PUBLIC` / `anon` / `authenticated` 的 `EXECUTE`（沿用 028 的结论，
  客户端此前可直接 `rpc()` 触发数据破坏）。应用侧新增 `src/lib/account/deletion.ts` 编排
  **「先擦除、再删号」**：擦除失败即中止（可重试），删号后的审计补记失败只记日志；
  `DELETE /api/user` 与新的 `deleteAccountAction` 共用该编排，服务端独立校验确认短语
  （`delete` / 「删除」）与会话归属，设置页补上此前只有 i18n 文案、没有实现的「危险区域」入口。
  `src/lib/privacy/data-policy.ts` 是保留天数、cron 任务名、擦除数据面、PII 键与确认短语的单一事实来源，
  `data-policy.test.ts`（40 条）把它与迁移 SQL、`docs/db/retention.md`、双语界面文案双向钉死；
  Mock 客户端镜像同一套擦除语义，另有 5 条 Playwright 用例覆盖两步确认与服务端拒绝路径。
  顺带记录一条真实运维缺陷：`docs/db/retention.md` 登记的所有 SQL 侧调度都依赖 pg_cron，
  而本地与云端项目的 `pg_extension` 均未安装该扩展，因此每周清理从未执行过——
  保留期此前只是文档上的承诺，现已在文档中显式标注为待启用的运维动作。

- **Production Smoke 定时漂移检测**：`.github/workflows/production-smoke.yml` 新增 UTC 02:17 定时任务 `smoke-main`，从 `package.json` 读取期望版本并对生产 URL 执行无副作用 smoke，保留 `production-smoke.json` artifact 30 天；新增 `pnpm check:production-smoke` 与契约测试，防止手动发布 smoke 与定时版本漂移检查在执行命令、URL、触发时间和证据留存上漂移。

- **Supabase 恢复告警契约与去重（E07）**：新增 `src/lib/observability/ops-metrics.ts` 固化 `ops.supabase.restore`
  的指标名与 `noop`/`restore`/`wait`/`escalate`/`skipped` 动作取值，并新增「文档阈值 = 代码常量」的契约测试
  （`alert-thresholds.test.ts` 校验 `email.backlog` / `push.backlog` 的 500 阈值与 `ops.supabase.restore` 的告警登记）。
  修复一条真实告警盲区：该指标此前只在成功读到 Management API 状态后上报，且把 `action=restore` 映射为 `1`、其余
  映射为 `0`，于是配置缺失与状态查询失败连样本都不产生，`escalate`/`skipped` 的样本值恒为 `0`，按「计数 > 0」
  配置的告警永远不会触发。现在 `runRestoreCycle` 的所有终态都经由同一个 `complete()` 出口上报 `value=1` 的计数样本，
  用 `action` 维度区分正常轮次与故障轮次；运维文档补齐指标表、三条按 `action` 分流的告警规则与按动作去重的说明。

- **Provider 降级指标契约（E06）**：新增 `src/lib/observability/provider-metrics.ts` 固化 `provider.fallback` 的指标名、
  原因取值与「缺失变量签名」去重闸门，`getStorageDriver()` 只引用常量，并改为上报**实际提供服务的驱动**而不是写死的
  `supabase`。补齐一处真实计量盲区：`RESEND_API_KEY` 缺失时发送层在启动计时器之前就抛错，`email.send.completed`
  连一条样本都不产生，于是「provider 没配上、邮件一封都发不出去」在失败率告警里完全不可见，只能等积压涨到阈值；
  现在该路径立即以 `{outcome="failure", reason="not-configured"}` 结束计时器，运维可据此即时告警。同时明确
  「OSS 四项全空」是默认驱动而非回退，不产生告警；`missing` 维度改为按字母排序的缺失变量名列表，去重不再依赖配置书写顺序。
- **上传成功率指标分层与契约化（E05）**：新增 `src/lib/observability/storage-metrics.ts` 固化
  `storage.upload.completed` 与 `upload.request.completed` 两个指标名、provider/operation 集合与
  `success` / `failure` / `cancelled` 取值，驱动与领域服务只引用常量，不再在各调用点手写字面量。
  补齐此前的计量盲区：`storage.upload.completed` 只覆盖 provider 对象写入，provider 写入成功但
  元数据回写失败并回滚的用户可见失败在指标里仍是 `success`；现在 `upload.request.completed`
  以 `operation` + `outcome` 覆盖 provider 写入、元数据回写与回滚整条链路，用户取消单列 `cancelled`
  不计入失败率。配套补齐驱动层与领域层测试（4 个 provider/结果组合 + 5 个请求终态），把
  digest / push-retry 路由测试里重复的 `metricEvents` 提取为共享测试工具。

- **Cron 调度与指标契约（E03）**：修复 `/api/cron/digest` 在生产从未被 `vercel.json` 调度、导致摘要邮件链路静默停摆的问题；
  两条 cron worker 现在统一校验 `CRON_SECRET` 并上报带稳定原因的 `cron.auth.rejected`，摘要 worker 的完成指标覆盖完整运行时长，
  500 路径会记录 `email_worker_runs.error` 并上报失败指标。新增 `pnpm check:cron-contract`，以注册表双向校验 Vercel 调度、
  路由方法、每轮指标与运维文档，平台级保活任务需显式登记豁免。

- **请求链路追踪关联 ID（E02）**：`x-request-id` 现在由 `src/proxy.ts` 统一解析上游值或生成新 ID，注入下游请求头并回写到响应头（放行与重定向分支各一次）；上游 ID 只接受不超过 128 字符、仅含 `[A-Za-z0-9._:-]` 的可打印 token，换行/制表/空格与超长值一律拒绝并重新生成，避免日志注入。新增 `logActionError` 与已有的 `logApiError` 共用同一实现，所有 Server Action 的裸 `console.*` 与`logger.error` 迁移到带 trace 的入口。配套 `pnpm check:trace-coverage` 门禁把约定固化为可执行规则：扫描 Route Handler 与 Server Action 禁止裸日志、校验错误入口与 `src/lib/trace-id.ts`、`src/proxy.ts` 契约，边界集合为空或豁免登记过期即失败。

- **Appark 生产采样配置（E01）**：新增 `NEXT_PUBLIC_APPARK_SAMPLE_RATE`，以事件级概率采样控制
  APM 流量；取值 `[0, 1]`，缺省 `1` 保持全量，`0` 可静音，非法值在环境与 provider 诊断中告警并
  回退到 `1`，避免配置笔误静默关闭可观测性。采样在入队前执行，业务与错误事件使用同一策略。

- **发布标签与 Release Notes 自动化门禁（J07）**：新增 `pnpm check:release-tag`，要求
  `vX.Y.Z` 标签与 `package.json` 版本一致、`CHANGELOG.md` 存在带合法日期的同版本已发布章节，并在显式
  指定输出文件时从该章节生成 Release Notes；同时审计 `release.yml` 必须全历史 checkout、冻结锁文件安装、
  在创建 Release 前运行 `pnpm check:all` 与带 `--tag "$GITHUB_REF_NAME"` 的标签校验，并以
  `gh release create --notes-file` 发布审核过的 CHANGELOG 内容，禁止 `--generate-notes` 绕过仓库内发布说明。

- **ADR 决策记录治理**：补齐 README 索引中缺失的 ADR-010–013，将 ADR-005 标记为被
  ADR-013 取代，并用新增 ADR-014 正式记录 React Table v9 原生 API 迁移；新增
  `pnpm check:adr` 校验 ADR 编号、状态、日期、必要章节、索引双向一致及取代链引用，
  防止后续新增决策时索引与状态再次漂移。

- **门禁接线审计**：新增 `pnpm check:gates`，要求每个 `check:*` 门禁都必须在 `scripts/check-all.sh`
  与某个 GitHub workflow 中执行，或在豁免表中登记仍成立的理由；同时校验 `check-all.sh` 不引用已删除的
  脚本、`.github/RELEASE_CHECKLIST.md` 逐字引用的 workflow / job 名真实存在、打标签版本与 `package.json`
  一致。审计发现并修复了 `check:agents` / `check:docs` 只在本地聚合执行、CI 从未覆盖的缺口。

- **本地 Mock 开发指南与一致性门禁**：重写 `docs-site/mock.md`、`docs-site/zh-CN/mock.md` 与
  `docs/architecture/13-mock-system.md`——三份文档此前只登记 6 张表、把进程级缓存说成「请求级」，
  并把路由分支写成已随 ADR-007 退役的 `middleware.ts`。新文档给出 18 张受支持表的完整清单、
  Mock 状态模型（`globalThis.__indiestackMockCache__` + `resetMockCache()` + `createMockRequestStore()`）、
  9 个 mock-only E2E 端点、Push 保留端点、Playwright 注入的环境变量与真实限制。新增
  `pnpm check:mock-docs` 按实现做双向校验（表名/端点逐项相等、每份文档必须覆盖开启条件与
  `src/proxy.ts` 接入点、旧错说法不得回流，抽取为空时失败封闭），21 条门禁单测随 `pnpm check:all`
  与 CI 执行。

- **Provider 配置诊断与文档一致性门禁**：新增 `src/lib/providers/diagnostics.ts`（纯函数，9 个
  provider / 28 个环境变量的 `ProviderReport`、`formatProviderReport`）与 `pnpm provider:doctor`
  （`--json` / `--help`，发现阻塞问题退出码 1），逐项报告 `ready` / `disabled` / `degraded` /
  `misconfigured` / `missing`，只输出 provider id 与变量名、**从不输出凭据值**。配套
  `docs-site/provider-diagnostics.md` 与中文版写实启用条件、fallback 与排障映射，并用新增
  `pnpm check:provider-docs` 按运行时注册表双向校验（provider id 与环境变量缺一即失败、文档源为空
  时失败封闭），24 条单测随 `pnpm check:all` 与 CI 执行。


- **贡献者测试矩阵与门禁**：新增 `docs-site/testing.md` / `docs-site/zh-CN/testing.md` 与单一事实源
  `src/lib/testing/test-matrix.ts`，把 11 个改动领域（UI、Server Actions、Route Handlers、认证 MFA、
  数据库迁移、RLS 安全、多语言、Provider、Mock、CI 脚本、文档）映射到覆盖路径与**最小**必须运行的门禁，
  避免贡献者只跑 `pnpm test` 就提交。新增 `pnpm check:test-matrix` 校验两份文档：每个领域必须登记且
  命令必须写在该领域自己的行里，引用的每个 `pnpm <script>` 必须真实存在于 `package.json`（内置命令
  白名单除外），IO 层另外确认覆盖路径在磁盘上仍然存在，抽取为空时失败封闭，14 条单测随 `pnpm check:all`
  与 CI 执行。

- **迁移回滚 Runbook 与一致性门禁**：新增 `docs/operations/migration-rollback-runbook.md`，统一迁移触发出动、
  前向修复优先决策、各类 schema 变更的逆向风险、操作与回滚后验证、权限审批及演练记录，并明确数据库不自动回滚。
  新增 `pnpm check:migration-runbook`，校验八个必备章节、关键凭据/回滚事实、最新迁移标记与
  `supabase/migration-manifest.json` 一致、文档引用的迁移文件真实存在、必备和引用的 `pnpm` 脚本真实可执行，
  抽取为空时失败封闭；20 条单测接入 `pnpm check:all` 与 CI。
- **E2E 安全并行化（J02）**：把 86 条 Playwright E2E 分配到两个独立 CI shard；每个 shard 有自己的 dev server，
  内部仍保持单 worker，因此加速不破坏共享 Mock 状态隔离；4 条视觉基线只在 shard 1 执行一次。Playwright 默认仍为单 worker，只有显式
  `PW_FULLY_PARALLEL=true` 才启用隔离实验；新增配置回归测试防止 shard、artifact 命名或默认串行策略漂移。
- **CI 并行与缓存优化（J03）**：CI 从「一条串行链」改为「廉价门禁先失败、昂贵作业并行」——覆盖率测试从
  静态门禁 job 拆到独立 `Unit Tests` job，与静态门禁并行执行，`Build` / `E2E (Playwright)` 的 `needs` 仍然
  只指向最快的 `Lint & Type Check`，因此不再为一次覆盖率运行多等一两分钟。E2E 用 `actions/cache` 缓存
  `~/.cache/ms-playwright`（键含 `hashFiles('pnpm-lock.yaml')`，Playwright 版本变化即失效，
  `install --with-deps` 仍补齐系统依赖）；触发 PR 的工作流新增 `concurrency` +
  `cancel-in-progress`，同分支连续推送会立刻取消被取代的运行，而 main/develop push 与 schedule 不取消。
  新增 `pnpm check:workflows` 把工作流卫生固化为门禁：作业必须有 `runs-on` / `timeout-minutes`，
  `uses:` 必须固定在 semver 标签或 40 位 SHA（`@main` / `@latest` 失败），`needs` 必须指向真实作业，
  触发 PR 的工作流必须声明非 `false` 的 `cancel-in-progress`，`pull_request_target` 直接禁止，
  工作流引用的 `pnpm <a:b>` 脚本必须真实存在，并锁定 ci.yml 的并行/缓存拓扑（28 条单测）。

- **CodeQL 扫描强度与告警处置门禁（J04）**：新增 `pnpm check:codeql`，把「告警零回归」的**前置条件**从
  「CodeQL 还开着」细化为可执行契约：`init` / `analyze` 必须同时存在且固定在 `github/codeql-action@v4`、
  语言覆盖 `javascript-typescript`、查询套件保持 `security-extended`、SARIF `category` 不漂移、
  `security-events: write` 与 `timeout-minutes` 都在、`push` 覆盖 `main`/`develop`、`pull_request` 覆盖 `main`、
  `schedule` 仍是每周一次（退化为每日失败）；`paths` / `paths-ignore` 只认 `push` / `pull_request` 触发块，
  默认不允许排除任何路径，`paths` 白名单不得漏掉 `src` / `scripts` / `e2e` / `supabase`。配套新增
  `docs/operations/codeql-alert-triage.md` 作为告警处置单一事实来源（严重度阻断阈值 `security-severity >= 7.0`、
  5 个工作日内完成分诊、只允许 `false positive` / `won't fix` / `used in tests` 三种 dismissal 理由），
  门禁同时校验 runbook 章节与这些数字同源，文档漂移即失败。44 条单测（含读取真实工作流与 runbook 断言零问题）
  接入 `pnpm check:all` 与 CI。真实告警列表与基线对比仍需 GitHub `security-events: read` 权限，属外部依赖。

- **Secrets Scan 强度与泄漏处置门禁（J05）**：新增 `pnpm check:secrets-scan`，把「密钥零回归」的前置条件
  固化为可执行契约：`gitleaks/gitleaks-action` 固定在 `v3`、`checkout` 必须是 `fetch-depth: 0` 全历史扫描、
  扫描作业有超时、`GITHUB_TOKEN` 正确接线且权限只有 `contents: read`，`push` 覆盖 `main` / `develop`、
  `pull_request` 触发保留，自定义配置只能指向 `.gitleaks.toml`。`.gitleaks.toml` 存在时，
  `[allowlist]` / `[[allowlists]]` 的每条 `paths` / `regexes` / `stopwords` / `commits` 都必须登记在契约中
  （默认空），防止用宽松排除规则让扫描结果悄悄变空。配套新增
  `docs/operations/secrets-leak-response-runbook.md` 作为泄漏响应单一事实来源（首次响应 10 分钟、
  24 小时内完成轮换、只允许 `false positive` / `used in tests` 两类 allowlist 理由），门禁同时校验
  runbook 章节与这些事实同源。规则由 `src/lib/security/secrets-scan-policy.ts` 的纯函数与 48 条单测覆盖，
  接入 `pnpm check:all` 与 CI。


- **Server Action 错误码翻译门禁（D02 / D03）**：`action-result.ts` 的注释早就写明「失败时
  `error` 是 i18n 错误键，客户端经 `ta(error)` 翻译」，但 `fail(error: string)` 是 `string`，
  这条约定此前没有任何机制守得住。新增 `pnpm check:action-errors`：从产出侧提取错误码
  （导入 `action-result` 的 `fail("code")` 与 `fail(expr ?? "code")` 兜底、导入 zod 的文件里
  校验器的末位字符串实参），要求每个码在**每个** locale 的 `actions.json` 有键、且各 locale
  文案不得逐字相同；消费侧禁止把 `result.error` / `authErrorKey(err)` 这类错误码原样放进
  `title` / `description` 等展示属性。提取不到任何错误码即失败封闭，两条例外清单过期同样失败
  （当前豁免表为空）。产出侧按 import 判定而非函数名，否则 `codeql-alert-policy.ts` 里记账用的
  `fail("push")` 会被误当成用户可见错误码。规则由 `src/lib/i18n/action-errors.ts` 纯函数 +
  24 条单测覆盖（含真实仓库反例：删掉 `projectNotFound` 文案、还原修复前的裸渲染调用点），
  接入 `pnpm check:all` 与 CI，并登记进贡献者测试矩阵的 `i18n` 领域。

- **翻译值完整性门禁（D02 / D03 剩余部分）**：`pnpm check:locales` 此前只比对 en 与 zh-CN 的**键集合**，
  于是「加了键但忘了翻译」在构建上与翻译对了完全同色——`settings.sections.security.title` 就长期是
  英文 `"Security"`，而同级的 `danger` 分区早就翻成「危险区域」。现在同一道门禁审**值**：
  `zh-CN` 文案里一个汉字都没有即失败，值是小写开头的驼峰单词（`projectNotFound`）则按「把键名/错误码
  当文案」单独报一条更具体的规则（后者必然也不含汉字，若先判漏翻译前者永不可达）；英文侧不要求任何文字，
  `and` / `days` 不会被误伤。确实不翻译的值要在 `UNTRANSLATED_VALUE_ALLOWLIST` 逐项登记理由，
  支持 `zh-CN:blog.posts.*.slug` 形式的单段通配——只匹配一个路径段，放行 `slug` 不会顺手放行同数组的
  `title`。审计覆盖消息数组内容并**按下标展开路径**：`home.statLabels`、`terms.sections[].content`、
  `blog.posts[].title` 这些 `t.raw()` 直接渲染的营销正文占了文案的一半，把数组当叶子丢弃就等于只审一半；
  键对称也因此精确到叶子路径，少一篇文章就是少一个键。实测 en/zh-CN 各 1235 条叶子路径对称、
  2470 条文案受审、86 条值由 38 条登记放行（品牌名、邮箱/验证码占位符、slug/版本号/分类枚举等结构字段）。
  写这道门禁时发现自己对汉字区间的判定是错的：字面字符区间 `[豈-﫿]` 的起点实为 U+8C48，
  整个谚文块 U+AC00–U+D7AF 落在里面，`한국어` 会被判成「含中文」而静默放行——改为显式码点，
  并留下一条谚文反例测试。规则由 `src/lib/i18n/translation-values.ts` 纯函数 + 31 条单测覆盖
  （含复现修复前真实值的反例：`"Security"`、`deleteProjectNotFound = "projectNotFound"`、数组里的英文），
  抽不到值 / 未登记 locale / 登记项过期同样失败。

- **术语一致性门禁与中英术语表（D01）**：值审计能挡住「没翻」，挡不住「翻得不一致」——
  同一个团队角色在成员列表里叫「拥有者」、在错误提示里叫「所有者」（都是 `owner`），两侧键对称、
  两边都有汉字，值审计完全无感。新增 `pnpm check:glossary`：按「英文侧命中术语 → 中文侧不得用禁止变体」判定，
  且只有当指定译法**缺席**时才算违规——一句话可以同时翻译两个不同概念
  （`notification preferences and alerts` → 「通知偏好和提醒」，「提醒」译的是 `alerts`，不是漂移）。
  术语表 14 项，逐项按当前文案实测过；`docs/architecture/10-i18n.md` 的表格与代码里的 `GLOSSARY`
  必须**双向逐字相等**，文档不能比规则更宽或更旧。失败封闭：一条术语都没命中、术语条目从未被用到（僵尸规则）、
  豁免不再命中同样失败。按英文原值逐条核对全库后，真正的漂移只有两处——`devicesDesc` 的「账号」与
  团队角色的「拥有者」，已统一为「账户」「所有者」；门禁首轮 271 次 (键, 术语) 比对、0 违规、0 豁免。

- **应用层不再把自己钉死在物理方向上（D08）**：项目只有 `en` / `zh-CN` 两个 LTR 语言，
  「支持 RTL」不是本期目标；但 `mr-2` 这类物理方向类会让未来的任何 RTL 语言从零改起，
  而它的逻辑等价物 `me-2`（`margin-inline-end`）在 LTR 下**渲染结果完全一致**——零视觉代价。
  应用层 74 处物理方向类（33 个文件）已迁为逻辑方向（`ml-/mr-`→`ms-/me-`、`pl-/pr-`→`ps-/pe-`、
  `left-/right-`→`start-/end-`、`text-left/right`→`text-start/end`、
  `rounded-tl/tr/bl/br/l/r`→`rounded-ss/se/es/ee/s/e`、`border-l/r`→`border-s/e`），
  并新增 `pnpm check:direction` 要求应用层保持 **0 处**、扫不到文件即失败封闭
  （`src/lib/styling/direction.ts` 纯函数：只看**字符串字面量内部**的类名 token，先剥注释，
  所以「注释里讨论 ml-」不算违规；`space-x-*` 在 v4 本身就是 `margin-inline-start`，不在禁止之列）。
  两处诚实的残留写进文档而不假装解决：`src/components/ui/**`（shadcn 基元，35 处 / 9 文件，
  升级会被上游覆盖）与 `translate-x-*` / `origin-left`（**Tailwind v4 没有逻辑等价物**，
  把它们列入禁止项只会逼人到处加 `dir` 判断）。长文本一半由 `e2e/responsive.spec.ts`
  在 375/768/1280 断言无横向溢出守住，布局约定（`min-w-0` + `truncate`、长 token 用 `break-words`）写入 i18n 架构文档。

- **语言切换的中文渲染端到端验证（D06）**：`e2e/smoke.spec.ts` 原有的两条断言只覆盖「键盘能打开菜单」
  与「切到 English 后写入 `app-locale` cookie」，而 English 本来就是默认语言——即使 zh-CN 消息完全
  加载失败，页面也会安静地退回英文或键名，两条断言照样通过。新增一条把 `简体中文` 选到底：断言 cookie
  值为 `zh-CN`、`<html lang>` 跟着变、首屏 Badge 渲染出 `生产就绪的 SaaS 启动模板` 且英文原文不再出现。
  这是全仓库第一条真正验证「中文用户看到中文」的 E2E。

- **账户删除数据层演练与孤儿巡检命令（E09 / A10）**：`033` 与 `src/lib/uploads/erasure.ts` 的注释
  都写着失败对象「可被 `find_orphan_upload_objects()` / `pnpm audit:storage-orphans` 发现并补删」，
  但那当时只是一句承诺——既没有命令，也没有人真的跑过这条链路。新增 `docs/operations/drills/account-erasure.sql`：
  在本地 `001`–`033` 库上造两个隔离账户与三类个人数据，按「对象清单 → 擦除 → 删号」的真实顺序跑完，
  20 条断言逐面核对（`api_usage` 删除而他人保留、`contact_messages` 按 `lower(btrim(email))` 命中大小写/空格变体、
  `audit_logs` 行数不变但身份列与 PII 键清空、非 object 的脏 metadata 整体清空、
  **擦除后删号前 `profiles` 仍在**这条顺序证据、删号后元数据行活下来且 `owner_id is null` 并进孤儿清单、
  他人团队封面因 `projects.logo_url` 仍引用而保留），整段包在事务里回滚。权限矩阵改为**真实调用**核验：
  `anon` / `authenticated` 逐个调用 032/033 的 7 个函数，14/14 全部 `permission denied`。
  新增 `pnpm audit:storage-orphans`（只读，不删任何对象）：把清单里 **owner_id 为空** 的行单列——
  那代表上传者账户已删而对象还公开可读，是隐私问题不是容量问题；`--json` / `--output` 留证据，
  退出码 0 / 1（执行失败）/ 2（`--fail-on-findings` 且有孤儿）。响应形状严格解析而不是断言，
  列缺失或类型漂移会让巡检失败，而不是把「读不懂」报成「没有孤儿」。
  顺带记录一条判定精度上限：`upload_object_is_referenced(text)` 拿不到 bucket，
  因此末段同名的不同对象会被保守判为「仍被引用」——只会漏删、不会误删。

### Fixed

- **四处调用点把内部错误码当文案渲染**：`contact-form`、`project-settings-form`、
  `project-delete-button`、`member-role-select` 直接把 `result.error` 放进 toast，用户在界面上
  看到的是 `projectNotFound` 这类标识；MFA 页两处同样漏了 `ta()`，其中 challenge 失败还直接透出
  Supabase 的英文原始 `message`。仓库其余 8 个 `authErrorKey` 调用点都是
  `ta(authErrorKey(err))`，本次把漏网的对齐到同一写法，并补齐缺失的
  `actions.projectNotFound`（双语）——否则光加 `ta()` 只会得到 `MISSING_MESSAGE`。
  顺带删除零引用、值就是错误码字面量的 `dashboard.projects.deleteProjectNotFound`，
  并把 zh-CN 设置页分区标题 `Security` 改为「安全」（同级 `danger` 分区早已翻成「危险区域」）。
- **根错误边界的语言自相矛盾**：`src/app/global-error.tsx` 写死 `<html lang="en">` 却整页只有
  中文文案，英文用户在这一页读不到任何可理解的内容，而组件注释声称「硬编码中文是项目默认语言」，
  与 `src/i18n/routing.ts` 的 `defaultLocale = "en"` 相反。该边界会替换整个 `<html>`、拿不到
  next-intl Provider，也就无法读取决定语言的 `app-locale` cookie，因此改为中英并列、
  中文片段显式标注 `lang="zh-CN"`——这是这一层唯一不会选错人的写法。


- **邮件队列口径与空轮次指标（E04）**：`countUnsentEmailNotifications` 与 `listUnsentEmailNotifications`
  此前各自维护一份相同的类型字面量数组，任一处改动都会让「积压计数」与「实际拉取」口径漂移；现统一为
  `EMAIL_NOTIFICATION_TYPES` 单一事实源，并新增仓库层测试按调用参数锁定两条查询使用同一集合、同一死信
  `.or` 过滤。空队列分支的 `email_worker_runs.duration_ms` 与 `cron.digest.completed` 此前恒为 0，
  现改为记录真实耗时；`email.backlog` 每轮上报的行为与「恰好等于阈值不告警」的边界也纳入测试。

### Fixed

- **静态 a11y 门禁此前形同虚设（D10）**：`check:a11y` 的图标按钮规则**结构上不可能命中**——
  外层 `if` 要求 children 里不存在任何 2 个以上字母的连续串，内层判定又要求组件名
  （`MoreHorizontal`、`<svg`）存在，两者互斥；并且它和同类门禁不同，**不打印任何计数器**，
  所以每轮「✅ 无未标注的图标按钮」在 CI 日志里完全看不出它什么都没做。运行时那道也救不了：
  `e2e/a11y.spec.ts` 的 axe 只访问 5 个公共页，从不进入仪表盘，而这 3 处全在仪表盘里。真实后果是 3 个
  `size="icon"` 且没有任何可访问名称的按钮长期在线（admin 用户表的改角色下拉触发器、
  新建项目与新建团队的返回按钮），屏幕阅读器对用户只会念出「按钮」。规则本体重写为
  `src/lib/ui/a11y-rules.ts`（纯函数）+ `scripts/lib/a11y-check.js`（IO）+ 薄 CJS 入口：
  判定保守优先（剥掉自闭合图标与 `Link`/`span` 等透传容器后什么都不剩才算纯图标按钮，
  所以 `{t("apiKeys.create")}` 这类插值算有文本、不误报），扫不到文件按 `A11Y_NO_FILES`
  失败封闭，输出 `scannedFiles / buttons / iconOnlyButtons` 让空转一眼可见。
  4 项变异测试（规则恒假、去掉失败封闭、可访问名称恒真、img 规则失效）均使 28 条单测变红。
  3 处 `aria-label` 复用已有消息键（`admin.users.changeRole`、`projects.detail.backToProjects`、
  `common.back`），不新增文案。**教训：一个永远不会失败的门禁比没有门禁更糟，因为它凭空制造信心。**
- **仪表盘从未被 axe 扫过，三处 AA 对比度长期不达标（D10）**：`e2e/a11y.spec.ts` 只访问 5 个公共页，
  从不进入登录后区域——这也是 3 个未标注图标按钮能同时躲过静态门禁与运行时审计的原因。把覆盖面扩到
  9 个已认证页（概览 / 项目 / 项目详情新建 / 团队新建 / 用户管理 / 团队 / 设置 / 通知 / API 密钥，
  共 14 条 axe 用例）后，当场抓到 3 处真实 WCAG 1.4.3 违规：`text-destructive` 作为文字是 3.76:1、
  `text-muted-foreground` 落在 `bg-muted` 上是 4.39:1、白字压 `bg-destructive` 只有 3.6:1，
  全部低于正文要求的 4.5:1。修复走 token 而不是逐处调类名：新增 `--destructive-text`
  （浅色 `0 72% 49%`＝#d72323，白底 5.06:1；深色 `0 90.6% 70.8%`＝#f87171，深色卡面 6.4:1），
  因为 `--destructive` 的语义是「红底配浅色前景」，深色模式下它是 `0 62.8% 30.6%` 的暗红，
  直接当文字几乎不可读；同时把浅色 `--destructive` 压到 `0 72% 49%`（白字 4.84:1）、
  浅色 `--muted-foreground` 压到 `240 3.8% 44%`（在 `--muted` 上 4.78:1、在白底 5.25:1）。
  9 处「destructive 作为可读文字」改用 `text-destructive-text`（表单错误、MFA 错误 ×4、删除账户、
  移除成员、API 密钥、统计趋势、分析页、webhook 错误），图标与背景仍用 `destructive`（图形对象要求 3:1，
  已满足）。视觉基线只有 `pricing` 一张变化（次要文字略深）。**这里踩过一个坑**：容器内自比
  4/4 通过并不能作为证据——CI 的视觉步骤跑在 `ubuntu-latest` 宿主机上而不是那个容器里，
  两者子像素抗锯齿不同，同一份代码累计 16353 px（约 1.0%）超阈值，CI 直接失败。
  基线最终改用 runner 自己产出的 `-actual.png`，并把 `docs/testing.md` 里
  「用该容器生成基线」的错误流程一并改掉。

### Added

- **动态翻译键不再无人看守（D04 补集）**：`check:i18n` 只扫静态 `t("字面量")`，
  动态模板 `t(`notifications.list.types.${type}`)` 按设计被跳过——这是文档里写明的盲区。
  新增 `pnpm check:dynamic-keys`（`src/lib/i18n/dynamic-keys.ts` 纯函数 +
  `scripts/lib/dynamic-keys-check.js` IO）：9 条契约声明「键前缀 → 权威取值集合」，要求每个取值在
  **每个 locale** 都有键（缺 → `DYNAMIC_KEY_MISSING`）、前缀下不得出现集合之外的键
  （→ `DYNAMIC_KEY_ORPHAN`）、源码里每个动态模板都必须登记契约（→ `DYNAMIC_KEY_UNREGISTERED_TEMPLATE`），
  零 locale / 零契约 / 空取值一律失败封闭。取值集合**必须来自代码常量**而不是抄消息文件，
  否则门禁同义反复、永远不会失败：为此把 `NOTIFICATION_TYPES` 抽到无依赖的
  `@/lib/notifications/types`（原模块一导入就初始化 Supabase 客户端），并把 `SHORTCUT_ITEMS`、
  `STRENGTH_LABELS`、角色与语言枚举收进 `.ts`。同前缀下的静态兄弟键（`common.shortcuts.desc` /
  `.title`）由静态引用放行，避免契约一登记全是误报。首跑即抓到两处：账单页
  `tc(`tierFeatures.${feature}`)` 从未被任何门禁覆盖，以及 `pricing.features.storage10Gb`
  是没有任何方案引用的死键（en/zh-CN 同步删除）。三项变异测试全红：删一个 zh-CN 键、
  注销一条契约、把 mock 枚举改回去。

### Fixed

- **mock 通知数据自造了一套不存在的类型**：`generateMockNotifications` 用
  `["info", "success", "warning", "error"]` 生成 `type`，而真实的 `NOTIFICATION_TYPES` 是另外 7 个。
  页面用动态键取标签并被 `try/catch` 兜住，于是 mock / 开发 / E2E 环境每次渲染通知列表都在抛
  `MISSING_MESSAGE` 后静默退回原始英文串，而 `check:i18n` 按设计不扫动态模板——没有任何测试或
  门禁会发现。现在生成器直接取 `NOTIFICATION_TYPES`，并新增 `src/lib/mock/data.test.ts` 把
  「mock 生成的枚举值必须落在权威集合内」钉住（通知类型、profile 角色与语言、团队成员角色）。

## [0.10.0] — 2026-09-13

> 主题：**UI 系统收口**——把界面层从「逐页手写」收敛为可复用系统，并补齐暗色模式、移动端断点与
> 键盘 / screen reader 回归。

### Added

- **状态色散落原生调色板、图表 token 无 @theme 映射（G02）**：新增 `src/lib/design/tokens.ts` 作为 design token 单一事实来源，登记 39 个 token（`--success` / `--warning` / `--info` 三组语义色各带 foreground）。此前状态提示直接写 Tailwind 原生调色板（`bg-green-500`、`text-amber-600`、`bg-red-500`…），同一语义在不同文件里色阶不一致，深色模式下也没有统一回退；现在 11 个业务文件统一走 `bg-success` / `text-warning` / `bg-destructive` / `bg-info`，`:root` 与 `.dark` 各补一份色值。同时补上 `--color-chart-1..5` 的 `@theme` 映射——`--chart-*` 此前只有原始变量，`text-chart-N` / `fill-chart-N` 实际并不存在。为防回潮新增 `pnpm check:tokens`（8 类规则码：根块或主题块缺失、token 缺根值或缺深色覆盖、`@theme` 映射缺失/悬空/未登记、白名单外使用原生状态调色板；28 条单测），接入 `pnpm check:all` 与 CI；Linux 容器内 4 项视觉基线保持无变化。

- **共享表单字段各写一套，label / aria 接线易漂移（G03）**：新增 `src/components/shared/form-field.tsx`，把
  「标签 / 控件 / 描述 / 错误」的 DOM 与 ARIA 接线收口到一个 context：`FormFieldControl` 自动注入 `id`、
  合并 `aria-describedby`、在错误时写 `aria-invalid="true"`，描述与错误各有稳定 id，错误文本以 `role="alert"`
  播报；13 个表单页/组件迁移到 `FormField` / `FormFieldControl`，`invite-member-form` 等原生下拉统一下沉到
  `native-select.tsx`（补齐此前漂移掉的 `disabled:` 外观）。`globals.css` 为 `[aria-invalid="true"]` 提供统一
  可见红边；新增 `pnpm check:fields` 门禁，禁止业务层直接写 `<select>`、复制控件类名长串或直接导入
  `ui/label`（3 类规则码、8 条门禁单测 + 17 条原语单测），接入 `pnpm check:all` 与 CI。

- **加载 / 空 / 错误状态各写一套，骨架屏丢 aria、加载文案硬编码（G04）**：新增 `src/components/shared/error-state.tsx`
  统一「图标 + 标题 + 说明 + 操作」的错误展示，4 个错误边界（`error` / `dashboard/error` / `global-error` /
  `not-found`）与查询失败卡片一并收敛到它，`code` 渲染页面唯一 `h1`，默认 `role="alert"`、只读提示可传
  `role="status"`。`page-loading.tsx` 重写为 `PageLoading`（`cards` / `dashboard` / `stats` / `list` / `spinner` 五种骨架）
  与 `LoadingIndicator` 单一来源，容器补 `aria-busy="true"`、骨架内嵌 `role="status"` 的 `sr-only` 加载文案并改走
  next-intl（此前 3 个手写骨架没有 `aria-busy`，加载文案硬编码中文）。12 个 `loading.tsx` 中 3 个手写 `Skeleton`
  全部收敛（仪表盘首页 60 行手写骨架 → `variant="dashboard"`），10 处裸 `<p>` 空态改用带图标的 `EmptyState`，
  同时删除零引用的重复加载组件 `page-loader.tsx` / `loading-state.tsx`。顺带修掉 `faq-list` 硬编码英文——
  搜索占位符与无结果文案改为 props（双语各补 2 个 key）。新增 `pnpm check:states` 门禁（4 类规则码、
  13 条门禁单测 + 14 条原语单测），接入 `pnpm check:all` 与 CI。

### Changed

- **Tailwind v3 遗留写法收口到 v4 原生机制（G01）**：自持的两段动画（进度条不确定态、路由切换进度条）从「裸 `@keyframes` + `@layer utilities` 手写类」迁到 `@theme` 的 `--animate-progress-indeterminate` / `--animate-navprogress` token（keyframes 内联进同一块），使用处回到 `animate-<token>` 工具类，宽度用普通工具类 `w-[30%]` 表达；删除仓库内已无引用的 `.step` / `.step:before` 死代码与尾部裸 `@keyframes navprogress`。同时把试点页与共享表单里的 v3 语义类名升级：`bg-gradient-to-b`→`bg-linear-to-b`、`outline-none`→`outline-hidden`（focus-visible 场景，含 forced-colors 处理）。为防回潮新增 `pnpm check:tailwind` 构建门禁（7 类规则码：`@config`/JS 配置/`tailwindcss-animate` 依赖/`@theme` 缺失/未被 token 认领的 `@keyframes`/任意值动画/v3 重命名工具类，24 条单测），接入 `pnpm check:all` 与 CI；构建产物 CSS 已复核 `.animate-navprogress`、`.animate-progress-indeterminate`、`.bg-linear-to-b`、`.outline-hidden` 正常落盘。

### Fixed

- **深色模式首帧闪烁与主题持久化失效（G05）**：根布局新增带 CSP nonce 的内联阻塞脚本，在 CSS 解析前
  读取 `ui-theme` 并写好 `<html>` 的 `light`/`dark` class 与 `color-scheme`，深色用户不再先看到一帧浅色；
  `localStorage` / `matchMedia` 各自兜底，隐私模式或老浏览器下退化为系统偏好而不是中断。
  同时修掉存储键不一致（Provider 写 `ui-theme`、其它地方读 `theme`）导致刷新后主题丢失的问题：
  键名与解析规则收口到 `src/lib/theme/theme.ts`，Provider、切换按钮与 E2E 共用同一份定义，
  system 模式改为监听 `prefers-color-scheme` 实时跟随。新增 13 条单测（含 jsdom 内联脚本行为）与
  `e2e/theme.spec.ts` 6 条 E2E（含阻断客户端 bundle 的首屏断言）。

- **移动端断点回归：导航不可达与横向溢出（G06）**：新增 `e2e/responsive.spec.ts`（375 / 768 / 1280 三个断点）
  后暴露两个真实缺陷。其一，`@utility container` 恒为 2rem 内边距，在 375px 视口下把页头右侧操作区挤出视口
  （`scrollWidth` 428 > 375），首页 / 功能页 / 定价页 / 仪表盘全部横向滚动；改为手机 1rem、≥640px 恢复 2rem。
  其二，仪表盘侧边栏是 `hidden md:block`，手机上整个导航消失，用户只能手改地址栏才能到达分析、团队、设置等页面；
  现在新增 `MobileDashboardNav`（ui/sheet 左抽屉，跳转后自动关闭）保证导航可达，页头断点由 md 提升到 lg 并让
  汉堡菜单带上 `aria-label` / `aria-expanded` / `aria-controls`，触屏设备不再渲染无用的快捷键入口。
  导航链接与角色、未读状态抽出 `dashboard-nav-links` / `use-is-admin` / `use-unread-notifications` 供桌面侧边栏与
  移动抽屉共用，避免两侧漂移；新增 18 条单测与 11 条 E2E，Linux 容器内 4 项视觉基线保持无变化。

- **键盘与 screen reader 交互回归：跳过导航不生效、Esc 不关闭菜单、折叠侧边栏无可访问名称（G07）**：新增 `e2e/keyboard.spec.ts`（6 条，全部基于角色与可访问名称断言）后暴露四处真实缺口。其一，`#main-content` 不可聚焦，键盘用户激活「跳到主要内容」后焦点仍停在链接上，屏幕阅读器不会切换上下文；现在四处 `<main>` 补 `tabindex="-1"`，激活后焦点确实落进主内容。其二，移动端页头菜单只能再点按钮关闭，Esc 无反应且焦点丢失；现在 Esc 关闭并把焦点交还汉堡按钮。其三，仪表盘折叠按钮没有可访问名称也不暴露状态，折叠后图标链接只剩 `title`；现在按钮带 `aria-label` / `aria-expanded` / `aria-controls`，折叠后的链接改用 `aria-label` 保留名称。其四，`?` 快捷键只挡了 input/textarea/select，在 contenteditable 与 `role="textbox"`（命令面板输入框）里输入 `?` 会误弹帮助，且 `⌘?` / `Ctrl+?` / `Alt+?` 未排除，现已一并拦截。新增 13 条单测与 6 条键盘 E2E，Linux 容器内 4 项视觉基线保持无变化。

## [0.9.0] — 2026-09-13

> 主题：**安全与权限边界收口 + 测试与发布门禁加固**

### Added

- **上传对象元数据表（孤儿对象可枚举）**：新增 `031_upload_objects.sql` 的
  `public.upload_objects`，记录每次 `put` 的 bucket / object key / 所有者 / 字节数 / MIME /
  sha256 / 状态，`(bucket, object_key)` 唯一，替换或回滚时把旧行标记 `deleted`，使
  `status = 'active'` 直接等于「数据库认为应该存在的对象」，可与 bucket 实际列表做双向差集找孤儿。
  上传服务改为 `put → 落元数据 → 回写业务表`，元数据写失败即删除对象并返回 `uploadFailed`
  （不再产生没有登记的公开对象），旧对象删除失败则不标记 `deleted`（避免漏报）。
  该表 RLS 打开且零策略、额外收回 `anon` / `authenticated` 写权限，只有 service_role 可读写；
  新增 `src/lib/repositories/upload-objects.ts`、`src/lib/uploads/checksum.ts`，mock 支持复合
  `onConflict`，并登记进 service-role 清单与 server-only 表分类。数据模型、写入协议、运行时
  身份矩阵与巡检 SQL 见 [docs/db/upload-metadata.md](docs/db/upload-metadata.md)。

- **Storage bucket 策略审计跟随代码，而不是写死的 `avatars`**：新增
  `src/lib/security/storage-policies.ts`，从 `src/**` 发现所有被引用的 bucket、从迁移最终态
  （`create policy` / `drop policy` 归约）推导生效的 `storage.objects` 策略，再做交叉验证：
  未登记 bucket（`STORAGE_BUCKET_UNDECLARED`）、没有建行迁移（`STORAGE_BUCKET_UNVERSIONED`）、
  没有生效策略（`STORAGE_BUCKET_UNPOLICED`）、写策略未同时钉住 `bucket_id` 与 `auth.uid()`
  目录（`STORAGE_WRITE_POLICY_UNSCOPED`）、读策略没有 `bucket_id` 过滤
  （`STORAGE_READ_POLICY_UNSCOPED`）、私有 bucket 出现客户端读策略
  （`STORAGE_PRIVATE_BUCKET_PUBLIC_READ`）、公共读 bucket 缺少客户端 SELECT
  （`STORAGE_PUBLIC_BUCKET_UNREADABLE`）全部失败封闭。新增 20 条单测与
  [docs/db/storage-policy-audit.md](docs/db/storage-policy-audit.md)（含真实数据库目录核对与 6 行身份矩阵）。

- **邮件 worker 运行记录保留期**：新增 `027_email_worker_runs_retention.sql`，`cleanup_old_email_worker_runs()`
  按 90 天保留期清理 `email_worker_runs`（与 `notifications` / `webhook_events` 对齐），并通过带
  守卫的 `pg_cron` 任务每周日 04:15 执行（未安装 `pg_cron` 的环境自动跳过）；`security definer` +
  空 `search_path`，只按 `created_at` 时间窗批量删除。保留策略矩阵更新到 [docs/db/retention.md](docs/db/retention.md)。
- **Push 重试链路 E2E 覆盖**：新增 mock-only 的 `https://push-e2e.test` 保留端点传输层
  （`src/lib/mock/push-transport.ts`）与 `/api/e2e/push-queue` 种子/查询/重置端点，
  只替换 `web-push` 的底层 `https.request`，适配器的配置校验、载荷构造与错误映射保持真实；
  新增 `e2e/push-retry.spec.ts` 10 条用例覆盖 401 鉴权、空队列、成功投递、瞬时失败退避、
  超过重试上限进入死信、410 撤销订阅、订阅缺失、用户关闭 Push、通知行缺失与终态保留策略清理。
  该覆盖补齐 v0.8.0 发布文档缺口审计中记录的已知缺口（mock-only，不等同于真实 push service 验证）。

### Changed

- **依赖补丁刷新**：`next` / `eslint-config-next` / `@next/bundle-analyzer` 16.3.4 → 16.3.5，
  `next-intl` 4.14.3 → 4.14.4，`lucide-react` 1.44.0 → 1.45.0；`eslint` 10 与 `typescript` 7
  两个 major 升级需要专项迁移，本次不动（`pnpm dep:health` 继续跟踪）。
- **Stripe Webhook 幂等键收窄为 `(provider, event_id)`**：`webhook_events` 的唯一约束由
  `event_id` 单列改为 `(provider, event_id)` 复合唯一，并新增 `attempts` / `last_attempt_at`
  两列记录占位次数与最近一次占位时间（迁移 `030`）。避免将来接入第二个 provider 时 event id
  互相碰撞，同时让"某个事件被 Stripe 重试了多少次"直接可查。
- **审计日志分页不再请求精确总数**：`listAuditLogsPage()` 默认不再下发 PostgREST
  `count: "exact"`，改为可选 `{ withExactTotal: true }`，默认返回 `total: null`。
  `audit_logs` 永久保留、只追加，全表 `count(*)` 是这条查询里唯一随表增长的开销：
  本地 20 万行 `EXPLAIN ANALYZE` 实测 `select count(*)` 走 Parallel Seq Scan 12.99ms / 6956 buffers，
  而生产分页路径 `order by created_at desc limit 50` 走 `idx_audit_logs_created_at` 仅 0.082ms / 53 buffers。
  当前无调用方读取 `total`（管理页显示 `filteredLogs.length`），如需总量应改用 `count: "planned"`。
  复审数据见 [docs/db/index-review.md](docs/db/index-review.md)。

### Fixed

- **Stripe Webhook 重复投递不再重放副作用**：此前 `webhook_events` 只是"最后写一行日志"的
  记录表，处理器**先执行全部副作用**（写订阅状态、发"付款成功"通知）再 upsert，而 Stripe 是
  at-least-once 投递且会对非 2xx 重试，同一 `event.id` 反复投递会**重复写订阅、重复发通知**；
  F05 的"重复 event id 幂等"用例只断言日志行数，因此无法发现。现改为**先占位 → 再处理 → 后落状态**
  的租约模型：新增 `claim_webhook_event()`（`security definer` + 空 `search_path`，只授予
  `service_role`）原子占位，重复投递返回 `duplicate` 并回 200 且不执行任何副作用；副作用失败标记
  `failed` 并回 500，让 Stripe 的下一次重试可以重新占位（`attempts` 累加）；`received` 停留超过
  15 分钟（进程崩溃）同样可回收。占位 RPC 报错时**失败封闭**成 500 而非降级为 `duplicate`
  （否则数据库故障会被伪装成"已处理"，Stripe 收到 200 停止重试而静默丢失状态同步）；副作用**成功
  后**的落状态失败只记日志、仍回 200（此时回 500 会让下次重试必然重放副作用）。E2E 断言从
  "日志行数"改为"副作用本身（通知行数）在两次投递后仍为 1"。协议、运维检查与回滚步骤见
  [docs/db/webhook-idempotency.md](docs/db/webhook-idempotency.md)。

- **RLS 全表回归门禁不再漏检策略**：`pnpm check:rls` 原先把策略名按"单个单词"截断
  （`"?([\w-]+)"?`），本仓库 35 条策略几乎全是带空格的句子
  （`"Users can view own profile"`），于是同表多条策略在最终态里互相覆盖、只报出 24 条，
  漏掉的 11 条 `USING` / `WITH CHECK` 从未被校验。现改为由纯函数
  `src/lib/security/rls-coverage.ts`（14 条单测）与 `check:supabase-security` 共用的最终态模型，
  并新增"每张表必须分类"规则：新表要么带策略，要么登记进 server-only 白名单
  （`email_worker_runs` / `mfa_recovery_codes` / `push_delivery_attempts` / `webhook_events`），
  否则 `TABLE_UNCLASSIFIED` 失败封闭。静态收敛结果与本地 `pg_policies` 逐条一致（35/35，双向零差集）。
  详见 [docs/db/security-audit.md](docs/db/security-audit.md)。

### Security

- **service_role 最小权限清单门禁**：新增 `src/lib/security/admin-client-boundary.ts`，用 TypeScript AST
  清点**每一个** `createAdminClient()` 调用点——29 个模块、80 个调用点——并为每个模块登记
  surface、授权模型与必须保留的源码证据字面量。`pnpm check:supabase-security`（含 `pnpm check:all`）
  现对未分类模块、过期清单条目、调用点漂移、未登记的表/RPC/bucket/`auth.admin` 方法、
  `use client` 模块引用与证据字面量缺失全部失败封闭。此前新路由只要 import 一次 admin client
  即可绕过评审直接读写任意表。同时 `/api/health` 不再持有 service_role：未鉴权的公开端点改用
  anon key 证明 PostgREST 可达（readiness 仍要求三个凭据齐全）。详见
  [docs/db/security-audit.md](docs/db/security-audit.md)。
- **审计日志写入面收口**：新增 `029_audit_logs_write_lockdown.sql`，删除
  `audit_logs` 上遗留的宽松 INSERT 策略
  `"Audit logs insertable by authenticated users"`（`with check (auth.role() = 'authenticated')`），
  并收回 `anon` / `authenticated` 的表级 INSERT/UPDATE/DELETE/TRUNCATE 权限。该策略对写入行内容
  零约束，任意登录用户可直接 `POST /rest/v1/audit_logs` 伪造审计记录并把 `user_id` 指向他人
  （本地复现为 HTTP 201）。服务端写入路径（`appendAuditLog()` 走 `service_role`，具备
  `BYPASSRLS`）与 `log_audit_action()` 均不受影响；`pnpm check:supabase-security` 新增
  `src/lib/security/client-write-policies.ts` 规则，对 server-only 表上残留的客户端写策略、
  以及缺失或恒真的 INSERT `WITH CHECK` 失败封闭。
- **SECURITY DEFINER 执行权限收口**：新增 `028_revoke_security_definer_execute.sql`，收回
  `cleanup_old_notifications()` / `cleanup_old_webhook_events()` / `cleanup_old_email_worker_runs()`
  与 `log_audit_action()` 对 `PUBLIC` / `anon` / `authenticated` 的 `EXECUTE`。此前 PostgreSQL 默认
  把函数 `EXECUTE` 授予 `PUBLIC`（Supabase 默认权限再显式授予 `anon` / `authenticated`），
  匿名用户可直接 `rpc('cleanup_old_notifications')` 强制删除保留期内的数据，或
  `rpc('log_audit_action')` 伪造审计日志；`pnpm check:supabase-security` 同步升级为对未撤权的
  `SECURITY DEFINER` 函数失败封闭（自动豁免 RLS 策略引用与触发器函数）。

## [0.8.0] — 2026-09-13

> 主题：**Web Push 持久化重试与死信队列**

### Added

- **Web Push 持久化重试与死信队列**：新增 `026_push_delivery_attempts.sql`，按
  `(notification_id, endpoint)` 持久化投递状态；瞬时失败按 60 秒起的指数退避重试，最多 3 次后进入死信，
  404/410 与订阅缺失会撤销端点并计入失效统计。新增受 `CRON_SECRET` 保护的
  `/api/cron/push-retry`（每 15 分钟、单轮 50 条），补充 `push.backlog`、死信与 worker 指标，
  站内通知和邮件通道不受 Push 失败影响。
- **Push 队列保留策略**：每次 cron worker 完成后清理超过 7 天的 `sent` 与超过 30 天的 `dead` 行，
  单一状态每轮最多清理 1000 行，`pending` 永不清理；响应新增 `pruned` 脱敏计数，并上报
  `push.queue.pruned` / `push.queue.prune_failed`，避免队列表无界增长。

### Fixed

- **Mock 范围查询时间比较**：修正 mock Supabase 的 `gte`/`lt`/`lte` 过滤，使 ISO 日期按时间戳比较、
  纯数字字符串按数值比较，并补上 `lte` 方法，支持在 mock-only E2E 中验证 Push 重试队列。

## [0.7.0] — 2026-09-12

> 主题：**Web Push 真实投递 + 安全与发布门禁加固**

### Added

- **通知中心实时刷新**：通知页通过 Supabase Realtime `postgres_changes` 订阅当前用户的
  `notifications` INSERT，并在 120ms 合并窗口后刷新列表；连接失败时显示离线状态并保留
  服务端渲染数据。新增 `025_notifications_realtime.sql`、组件测试和实时更新 E2E。
- **上传进度与取消**：头像和项目封面表单改为同源 XHR `/api/uploads/*`，显示真实
  上传百分比并支持取消；Route Handler 与 Server Action 共用上传领域 service，
  保留鉴权、MIME/文件头校验、大小限制、元数据回写失败回滚和旧对象清理。
- **Auth 邮件配置即代码**：新增 `scripts/lib/auth-email-templates.js` 与
  `scripts/apply-auth-email-templates.js`（`pnpm auth:email-config`），把
  [docs/design/email-templates.md](docs/design/email-templates.md) 的 5 封邮件骨架固化为可
  dry-run / apply / verify 的 Supabase Auth 配置补丁，并在生成前硬校验 CTA 变量与品牌头；
  CI `Security and configuration checks` 增加重定向白名单漂移门禁。
- **运行时身份矩阵**：新增 `pnpm smoke:supabase-identity`（`scripts/verify-supabase-identity.js`），
  使用真实 Auth + PostgREST + Storage API 验证 anon / authenticated / service_role 的
  租户隔离、`profiles` 可见范围、私有项目不可读与 `avatars` 前缀写权限；最近一次 20/20 通过，
  证据与局限记录在 `docs/db/security-audit.md`。
- **Supabase 自动恢复（应用侧兜底）**：新增 `/api/ops/supabase-restore` 与 Vercel Cron
  `0 4 * * *`。GitHub Actions 的 `schedule` 会在仓库 60 天无提交后被停用，因此恢复能力
  不再只依赖 GitHub；路由复用与 `scripts/supabase-auto-restore.js` 相同的判定（只有
  `status=INACTIVE` 才恢复），并以 `CRON_SECRET` 鉴权、`no-store` 返回结构化 action。
- **Passkey 完整登录闭环**：assertion 验签和计数器更新成功后，通过服务端一次性
  magiclink token 桥接 Supabase SSR 会话；token/action link/邮箱/userId 不返回
  浏览器或写入日志，已有 MFA 因子的用户继续完成 aal2 challenge。
- **视觉回归基线**：新增 `pnpm test:visual`（`playwright.visual.config.ts` +
  `e2e-visual/visual.spec.ts`），对首页、功能页、定价页和登录页做 1440×900 全页截图，
  像素差异门禁 0.1%；基线为 Linux Chromium PNG，需在
  `mcr.microsoft.com/playwright:v1.63.0-noble` 容器内生成，固定 UTC、浅色主题与
  禁用动画以消除环境抖动。CI 在 E2E 之后执行该套件，失败时上传 `test-results/` 差异图。
- **迁移漂移门禁（H09）**：`pnpm check:migrations` 从“只查文件名”升级为离线内容门禁，校验
  迁移命名、编号连续与唯一、空文件、UTF-8 BOM、CRLF、结尾换行，并把每个迁移的 SHA-256 与提交的
  `supabase/migration-manifest.json` 基线比对；新增 `pnpm update:migrations-manifest` 做仅追加的
  重新定基线，改写已基线化迁移会被拒绝，避免用重跑基线掩盖历史篡改。另新增只读的
  `pnpm check:migration-history`（需本地 `supabase start`）比对数据库迁移历史，对未应用迁移或
  数据库独有版本报错。规则由 `src/lib/migrations/migration-drift.ts` 的 43 条单测覆盖，静态门禁接入
  `pnpm check:all` 与 CI。

- **Web Push 真实投递**：`push-provider.ts` 从占位实现替换为真实 `web-push` 传输层（VAPID 鉴权、
  1 小时 TTL、10 秒超时、high urgency；缺密钥时 provider 保持 `configured=false` 并显式失败），
  新增 `push-notify.ts` 按用户扇出到全部订阅并撤销 push service 返回 404/410 的失效端点；投递接入
  通知事件边界，Push 失败不会抑制站内通知或邮件。设置页可在刷新后识别既有订阅并关闭通知
  （同时撤销数据库记录与浏览器订阅），新增 `NEXT_PUBLIC_VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`
  配置与中英 docs-site 运维章节。当前 Push 为即时 best-effort，尚无持久化重试队列或死信表。

### Changed

- **CHANGELOG 结构门禁（I05）**：新增 `pnpm check:changelog`（`scripts/check-changelog.js` +
  `src/lib/changelog/parse-changelog.ts`），校验 `[Unreleased]` 置顶且非空、版本标题与发布日期格式、
  版本降序且不重复、每个版本至少一个章节、章节至少一个顶层条目、条目非空且未超长；门禁接入
  `pnpm check:all` 与 CI 的 Lint & Type Check job，规则本身由 38 条单测覆盖。
- **依赖与 secrets 扫描门禁（H10）**：`pnpm check:security` 改为纯策略模块 + Node type-stripping CLI，
  拒绝被跟踪的环境/私钥文件，校验环境文件权限与客户端服务端密钥泄漏，要求 workflow 显式最小权限，
  并锁定 gitleaks、CodeQL、security-config 和 Dependabot 的触发范围、版本与权限配置；补齐
  `RESEND_API_KEY`、`VAPID_PRIVATE_KEY`，对 `pnpm audit --json` 的 high/critical 计数 fail-closed。
  规则由 54 条专项测试覆盖，继续接入 `pnpm check:all` 与 CI。
- **依赖安全刷新**：升级 React/React DOM 与类型包到 19.3.0，以及 Sentry、Stripe、
  next-intl、lucide-react、Zod 与 Node 类型的最新 minor/patch；`pnpm audit --audit-level high`
  无已知漏洞，`pnpm peers check`、`pnpm check:all`、`pnpm test:coverage`、`pnpm test:e2e`
  与 `pnpm verify:build` 全部通过。
- **种子数据重写**：`supabase/seed.sql` 改为自包含、可重复执行，先创建 `auth.users` 再写入
  两个隔离团队、三个项目、订阅、邀请、API key、会话、审计、通知与 usage 数据；修复了
  违反 `auth.users` 外键与 subscriptions 冲突目标无效导致的 `supabase db reset` 失败。
- **运维文档**：部署文档补充保活/恢复的双层结构与 `CRON_SECRET`、`SUPABASE_ACCESS_TOKEN`
  配置说明；安全审计文档用真实运行时矩阵替换“本地无法启动 Supabase”的过期描述。
- **测试与发布文档**：README 测试计数同步为 94 个文件 / 853 个测试，Smoke 记录更新到
  commit `16a285a` 与对应 Vercel 生产部署。
- **Auth 重定向白名单**：生产 Supabase 项目补入 Vercel preview 通配域名并回读校验通过
  （`http://localhost:3000/**`、生产别名、`https://*-sun1090s-projects.vercel.app/**`、
  `https://indie-stack-*.vercel.app/**`），preview 部署的登录回跳不再被白名单拦截。
- **Auth 邮件模板待启用**：Supabase 免费版 + 默认发件人禁止通过 Management API 修改模板
  （`rate_limit_email_sent = 2`，全项目每小时 2 封）。模板与命令已就绪，配置自定义 SMTP 或
  升级套餐后执行 `pnpm auth:email-config -- --apply`；在此之前该限制会在每次注册洪峰时先暴露。

- Passkey 登录选项、认证验证、注册选项和注册验证统一补齐 flag 门控、IP 限流、
  `no-store` 与失败后的 challenge cookie 清理；登录表单增加中英双语入口和共享 busy 状态。

### Fixed

- 英文页脚版权符号由 `&copy;` 改为 `©`：ICU 消息不解析 HTML 实体，此前英文站点页脚会
  原样显示 `&copy;`（中文文案一直使用 `©`）。

## [0.6.0] — 2026-09-12

> 主题：**发布门禁加固 + Supabase 免费版保活与自动恢复**

### Added

- **Release operations**：新增 v0.6.0 发布 runbook、生产 smoke test 矩阵和回滚 runbook，明确证据留存、停止条件、数据库向前兼容与回滚后验证。
- **Release documentation gate**：新增 `pnpm check:release-docs`，检查发布文档、双语 README、CHANGELOG 和关键操作命令是否存在且保持同步。
- **Supabase 免费版保活**：根目录 `vercel.json` 新增每日 Vercel Cron，`.github/workflows/health-check.yml` 追加每日 `schedule`（并改为免安装依赖、直接运行 `scripts/check-health.js`）；两者都探测 `/api/health`，触发一次 Supabase `limit(1)` 查询，避免免费版项目 7 天闲置被暂停。
- **Supabase 自动恢复**：新增 `supabase-auto-restore` workflow 与 Management API 脚本；每日检查项目状态，暂停时自动恢复，再等待数据库健康后退出，手动运行默认使用 `dry_run=true`。
- **Health readiness contract**：`/api/health` 增加 `ready`、`degraded` 和 `supabase.status`，保活与恢复脚本可区分“Web 正常但数据库未就绪”和完整可用。

### Changed

- **数据库迁移**：应用 022–024，补齐 MFA recovery codes 用户外键、营销 token 安全字段和 avatar storage policy；生产迁移前已保存 schema、roles 与业务数据快照。
- **Passkey 安全门禁**：验证接口默认关闭，只有显式设置 `NEXT_PUBLIC_FEATURE_PASSKEY_LOGIN=true` 且完成后端接入后才开放。
- **对象存储清理**：统一托管对象的替换/删除清理路径，避免头像与项目封面替换后遗留孤儿对象。
- **依赖与 CI**：升级 Vitest/coverage-v8 至 5.0.0、TypeScript 6.0.3 与 GitHub Actions；Dependabot 对 Vitest 同组升级，并忽略越过 Node 22 运行时大版本的 `@types/node`。
- **CI 安全基线**：各 workflow 默认只授予 `contents: read`，a11y 审计不再允许失败，新增依赖审计、i18n 使用检查、迁移漂移检查、Supabase 安全边界与仓库配置检查。

### Security

- 营销订阅确认/退订改为 POST 执行状态变更，GET 仅展示表单；新 token 使用 hash 和 7 天有效期。

### Fixed

- 修正 dashboard、API key、成员角色、资料完整度和项目删除等页面的 i18n key，避免生产构建时遗漏翻译。
- 保活、自动恢复和生产 smoke 探测改为有限重试瞬时网络错误、5xx 与未就绪 body，避免 Supabase 冷启动期间的 503 被误报为持续故障。
- 修复测试基础设施：Vitest 每个项目限制为 2 个 worker，Playwright 默认使用单 worker，避免高并发 jsdom / 共享 Mock 状态导致交互超时与互相清理；logger 仅在生产环境异步加载 Sentry，避免测试和构建进程加载监控运行时。

## [0.5.0] — 2026-09-05

> 主题：**邮件通道完善 + 对象存储接入 + 可观测性落地**

### Added

- **邮件通道完善（A 域）**：
  - 摘要同类型折叠：同类型 ≥3 条合并计数、明细截断 5 条 + 溢出提示（A01）
  - 发送失败重试计数与死信：`metadata.email_attempts` ≥3 由拉取侧过滤，不再阻塞队列（A02）
  - 高优先级通知实时单发：security_alert/team_invite/role_changed/payment_succeeded
    经 `notifyUser()` 事件触发即发，cron 兜底重试（A03）
  - digest 按用户时区错峰：本地 08:00 发送，空/非法时区回退 Asia/Shanghai（A04）
  - 营销邮件独立通道（迁移 016）：double opt-in 订阅确认 + 公开确认/退订路由 +
    强制退订页脚（A05）
- **对象存储（B 域，ADR-010）**：`StorageDriver` 双驱动抽象——默认 Supabase Storage，
  `OSS_*` 四项齐备切换阿里云 OSS（`ali-oss` 动态加载）；服务端中转上传
  （≤2MB，类型白名单/扩展名映射防穿越）；头像上传（B02）与项目封面（B03，复用
  `projects.logo_url`）接入
- **可观测性（C 域）**：Appark APM 轻量接入（ADR-011，无厂商 SDK、默认旁路关闭，
  checkout/cron 埋点）；cron worker 运行记录表（迁移 017，pulled/sent/failed/duration）；
  待发队列积压超阈值 Sentry 告警
- **认证安全（D 域）**：登录失败锁定收口进 rate-limit 键控滑窗并新增 IP 维度（D03）；
  会话设备列表与单设备吊销（迁移 018，GoTrue session id 登记心跳 + 设置页 UI，D02）；
  WebAuthn/Passkey 试点（迁移 019，feature flag 门控，注册/验证闭环，ADR-012，D01）
- **其他**：环境变量校验扩展（OSS/Appark 部分配置告警）

### Changed

- **TanStack Query 缓存策略统一（E02）**：`QUERY_KEYS` 单一来源 +
  `dashboardQueryOptions` 三档缓存档位（live/standard/admin），8 个调用点迁移
- **前端性能复审（E03）**：Supabase preconnect 补 `crossOrigin`（CORS TLS 复用修正），
  基线入档 `docs/operations/perf-baseline.md`

### Fixed

- 邮件模板 `String.replace` 特殊模式（`$&`）可能损坏用户内容 HTML 的隐患
- digest 空队列响应统一为 `{ sent, groups, failed }`
- dev 端 `components.json` 残留对已删除 `tailwind.config.ts` 的引用（`next build` 不读，
  `next dev` 会炸）
- `/(marketing)/contact` 表单 4 个 input 缺 `name` 属性（`id` 有但 server action 读 `formData.get(...)` 永远 null → submit 永远 `invalidInput` 失败；F02 E2E 复测发现并修复）

### Testing

- **E2E 邮件全链路（F01）**：`e2e/mail-flow.spec.ts` 覆盖 happy path（设置页开启营销邮件 →
  捕获 double opt-in 确认邮件 → 种通知 → 触发 digest cron → 断言摘要邮件主题含「N 条」
  - `email_worker_runs` 落表 pulled/sent/groups/failed）与 failure path（`?failNext=1`
    注入失败 → digest 返回 `failed=1` + `email_worker_runs.failed>0`）。
    Mock 端补：`MockQueryBuilder` 新增 `.or()/.not()/.contains()/.lt()/.is()/.upsert()`
    与 JSON 字段路径（`metadata->>email_attempts`）解析；`email_worker_runs` /
    `marketing_subscriptions` 表接入 mock 读写；mock profile `notification_settings`
    字段对齐真实 schema；`sendResendEmail` 支持 `RESEND_API_URL` 端点覆盖；
    E2E 专用路由（仅 mock 启用 + Bearer 校验）`/api/e2e/email-inbox`、
    `/api/e2e/seed-notifications`、`/api/e2e/email-worker-runs`、
    `/api/e2e/profile-timezone`（动态写入本机时区以命中 digest 错峰门控）。
    Playwright 配置注入 `RESEND_API_URL/KEY` + `CRON_SECRET` + `NEXT_PUBLIC_APP_URL` +
    `E2E_BEARER_TOKEN`；`pnpm test:e2e` 24/24 全绿（含 v0.4.0 既有 22 例 + F01 新增 2）。
- **E2E：admin / contact / MFA 页面（F02）**：`e2e/admin-contact-mfa.spec.ts` 覆盖 admin 概览页（统计卡片渲染）、admin/users 用户列表（mock 用户行可见）、admin/messages 消息列表可达、contact 表单 UI 流程（可达 + 字段填写 + submit 后无运行时错误）、mock contact_messages POST → GET 字段对齐（name/email/subject/message 全字段校验）。
  Mock 端补：mock 缓存切到 `globalThis.__indiestackMockCache__`，解决 Next.js 16 + Turbopack dev 将 server action 与 route handler 拆分到不同 chunk 时模块级 `let` 缓存不共享的问题（v0.5.0 F02 contact-messages 闭环踩到的真根因）；新增 `getMockContactMessages()` + `case "contact_messages"` 读写双路径；`/api/e2e/contact-messages` 提供 POST 端点（仅 mock + Bearer 校验）绕过 server action 跨进程不可见的限制；DELETE 走 admin client。Playwright 配置 `fullyParallel: false`（多 worker 并发会触发 DELETE/PATCH 互相覆盖），`pnpm test:e2e` 29/29 全绿（F01 24 + F02 5）。

### 质量

- 覆盖率门禁上调：branches 78 → 85（statements 91 / functions 93 / lines 92），
  实测 92.9 / 85.7 / 95.3 / 93.9；单测 556 → 668 个
- ADR 增补：ADR-010（对象存储）/ ADR-011（APM）/ ADR-012（Passkey）/ ADR-013（Tailwind v4 原生主题）
- **Tailwind v4 原生主题迁移（E01）**：移除 `@config` 桥接与 `tailwind.config.ts`，
  `@theme inline` + `@custom-variant dark` + `@utility container`；动画插件换成
  CSS-only 的 `tw-animate-css`（移除 tailwindcss-animate 依赖）
- 新增依赖：`ali-oss`（OSS 驱动，动态加载）、`@simplewebauthn/*`（Passkey 校验）

## [0.4.0] — 2026-09-05

> 主题：**Admin 运营闭环 + 数据层测试 + 集成接线**

### Added

- **两步验证（TOTP/MFA）全流程**：注册二维码/验证码确认/解除、登录挑战页 `/auth/mfa`（已验证因子强制 aal2）、备用恢复码（生成/兑换 + 前后端单测）
- **通知体系扩展**：通知类型常量（deployment/security_alert 等）、邀请/角色变更/支付成功的跨用户触发、邮件偏好联动矩阵（`notification-prefs`）、侧边栏未读 badge 轮询、单条/全部已读、读取失败错误态与空态引导
- **通知邮件 Worker**：`POST /api/cron/digest`（`CRON_SECRET` 鉴权）拉取待发通知 → Resend 发送 → `markEmailSent` 回执；按用户合并为摘要邮件，CTA 链接取 `NEXT_PUBLIC_APP_URL`（设计见 `docs/design/email-templates.md`）
- **联系消息运营闭环**：迁移 012/015（contact_messages + 处理状态机单向流转）、admin 收件箱（搜索/状态筛选/分页）、垃圾启发式拒收、联系页结构化数据
- **Admin 后台增强**：聚合看板（联系消息/webhook 事件统计）、用户列表服务端分页、webhook payload 查看、审计元数据 details 查看
- **登录安全**：失败分级锁定（邮箱滑窗 5 次/15 分钟）、登录审计日志（成功/失败/MFA/兑换/OAuth）、邮箱未确认时重发确认邮件、OAuth/MFA/会话丢失错误码 i18n 全覆盖
- **会话管理**：当前会话信息聚合 + 退出其他设备
- **数据保留策略**：迁移 014（pg_cron 守卫调度 + webhook 事件清理函数 + 策略文档 `docs/db/retention.md`）
- **API 质量**：错误格式统一收敛 `jsonNoStore`、日志 trace-id 统一（api-log）、health DB 自检、checkout 幂等/重复订阅拦截、og 缓存校验、未知 webhook 事件类型 Sentry 告警
- **环境变量校验模块**（zod 风格诊断 + 单测）
- **SEO/营销**：博客动态 OG 分享图、twitter card、sitemap 文章真实 lastmod、博客分类过滤、FAQ 搜索过滤、RSS feed、PWA manifest
- **UX 组件**：⌘K 命令面板（cmdk）+ 最近页面历史、面包屑导航铺开、QueryErrorState 错误重试铺开、EmptyState 统一空态、资料完整度卡片、离线横幅、路由进度条、定价页月/年切换（8 折年付）
- **测试覆盖**：repository 层 7 模块单测全覆盖、API 路由/actions 单测补齐（health/checkout/notifications/mfa/contact/webhooks）、safe-redirect fuzz/date 边界/CSV 注入变体、a11y 与 trace-id/CSP nonce E2E 断言

### Changed

- **TanStack Table v9 原生迁移**：移除 legacy 桥，显式 features + 行模型槽位（ADR-009）；DataTable 全面国际化（dataTable.* 751 键）、v9 排序表头自动接线
- bundle 基线 2467kB → 2603kB（admin 收件箱/恢复码/会话管理等功能增量，无新依赖）
- 硬编码路由收敛到 `ROUTES` 常量（invite-member/logout-all/notifications/blog 等）
- `.env.example` 补齐 CONTACT_EMAIL/APP_VERSION/VERBOSE_LOGGING

### Fixed

- webhook events action 补 admin 守卫（防绕过入口越权读取）
- 年付节省金额浮点精度取整；三页面面包屑改用 common 命名空间（修复 `dashboard.dashboard` 缺键）
- RECOVERY_CODE_COUNT 移出 use server 文件；recovery action node:crypto 改动态导入（修客户端代理导出分析失败）
- standalone 输出条件化（DOCKER_BUILD 门控）
- 迁移 011 补 profiles lower(email) 函数索引（EXPLAIN 复审发现 Seq Scan）

## [0.3.0] — 2026-08-23

### Changed（大版本升级专项）

- **Next.js 15 → 16**：Turbopack 构建默认化、middleware→proxy 约定迁移、eslint-config-next 16 原生 flat config、favicon.ico RGBA 问题修复、react-hooks/purity 合规
- **Tailwind CSS 3 → 4**：`@tailwindcss/postcss` 替代双插件、`@config` 桥接既有 JS 配置、移除 autoprefixer
- **TanStack Table 8 → 9**：经官方 `useLegacyTable` 桥迁移（v8 API / v9 内核），原生 features API 列为后续任务
- **lucide-react 0.x → 1.x**：品牌图标移除 → 内联 GithubIcon SVG 组件
- **zod 3 → 4**：error.errors → error.issues 迁移
- eslint 复杂度门禁（≤15 报错，存量文件显式豁免登记）
- Bundle 基线门禁适配 Turbopack 输出（客户端静态资源总量 2467kB）

### Added

- Profiles Repository 数据访问层试点（/api/user 与 inviteMember 已收口）
- ActionResult 判别联合类型 + notifications Action 迁移试点
- 审计日志 CSV 导出（feature flag 门控）
- 通知"全部标为已读"（Server Action + 双语翻译键）
- Webhook 事件日志表迁移（010_webhook_events.sql，待应用）
- skip-to-content 无障碍链接
- 索引复审清单、环境/Staging 规范、API 路由文档、ADR ×4、邮件模板设计、Sentry 告警指南
- 依赖健康报告脚本（pnpm dep:health）、Agent 索引一致性校验

## [0.2.0] — 2026-08-23

### Added

- **Playwright E2E 冒烟测试**（8 用例：营销页/认证流/Mock dashboard）并进 CI 独立 job
- **组件测试基础设施**（jsdom + Testing Library 双项目结构）+ CheckoutButton / RemoveMemberButton / InviteMemberForm 共 10 个用例
- **覆盖率阈值门禁**：核心逻辑 statements/functions/lines ≥90%、branches ≥78%
- **Middleware 路由守卫单测**（7 用例）
- **Stripe webhook 纯函数测试**（mapStatus/mapPlan，10 用例）
- **CodeQL 安全扫描** + **gitleaks 密钥扫描** + **Dependabot** 自动依赖跟进
- **i18n 翻译对称性 CI 校验**（`scripts/check-locales.js`，733 key 双语对齐门禁）
- **Agent 体系补全**：新增 10 号提交与发布管理 Agent（编码→审查→提交→部署角色链闭环）

### Changed

- **默认语言改为英文**（应用 `defaultLocale=en`；文档站英文提升为根路径，中文移至 `/zh-CN/`）
- CSP 安全头新增（覆盖 Supabase/Sentry 域名），加 Permissions-Policy，移除废弃的 X-XSS-Protection
- 数据通道约定入 CLAUDE.md：写操作走 Server Actions，API Routes 仅限外部回调
- Stripe webhook 移除内存 rate limit（防事件重试 429 丢失），纯函数抽离至 `lib/stripe/webhook-mappers`
- 文档站首页恢复 VitePress 标准布局，GitHub 占位链接修正为 Sun1090/IndieStack
- 依赖区间内小版本升级（Radix 全家桶、React 19.2、stripe 22.5 等），Stripe apiVersion 跟随 SDK 默认
- pnpm 固定 11.22.0（packageManager 字段 + Dockerfile corepack 对齐）
- engines.pnpm 提升 ≥11

### Fixed

- mapPlan 在 priceId 与环境变量同为 undefined 时误匹配为 pro 的边界 bug
- pnpm/action-setup 与 packageManager 版本声明冲突导致 CI 失败
- vercel.json 旧版 builds/public 字段被 Vercel 导入 API 拒绝；显式声明 outputDirectory=.vitepress/dist
- 文档链接指向已下线的旧文档站域名 → 更新为 indie-stack-docs-site.vercel.app
- 删除死路由 `/api/teams`（无调用方）、死 hooks ×5、零消费的 SupabaseProvider、未使用的 usehooks-ts 依赖
- Dockerfile 冗余 node_modules 复制与 next.config/package.json 多余复制
- CI 孤儿 docs artifact 上传步骤移除；PR 触发补 develop 分支

## [0.1.0] — 2026-07-19

### Added

- **Next.js 15 App Router** with Route Groups, Server Components, Server Actions
- **Authentication** — Supabase SSR auth with Email, GitHub, Google OAuth
- **Marketing site** — Landing page, Features, Pricing, About, Blog, FAQ, Changelog, Contact, Privacy, Terms
- **Dashboard** — Overview, Analytics, Projects, Notifications, Integrations, Profile, Settings, Team management, Billing
- **Supabase integration** — PostgreSQL database with RLS, Realtime subscriptions
- **Sentry error monitoring** — Client, Server, and Edge runtime config
- **Stripe-ready billing** — Subscription tiers (Free, Pro, Enterprise) with checkout flow
- **Team management** — Multi-tenant with roles (owner, admin, member), invites
- **Responsive UI** — shadcn/ui components, dark/light mode, mobile-first
- **CI/CD** — GitHub Actions workflows for linting, type-checking, building, deploying to Vercel
- **Alibaba Cloud OSS** integration for file storage
- **Appark APM** instrumentation
- **i18n-ready** architecture with zh-CN default locale
- **VitePress documentation site** — Bilingual (zh-CN/en) standalone documentation website with dark/light theme at `docs-site/`
- **Docker compose** — Local PostgreSQL development environment

### Technical Details

- TypeScript strict mode across the entire codebase
- Zod validation for all forms and API inputs
- Server Components by default, client components only where interactivity is needed
- Row Level Security on all database tables
- Auto-creation of profiles and personal teams on user signup
- Security headers (X-Frame-Options, XSS Protection, CSP-ready)
- Rate limiting infrastructure via `api_usage` table
- Image optimization with AVIF/WebP support

### Notes

- `docs/` directory contains complete architecture, setup, deployment, and configuration documentation
- Open `docs-site/` to view the interactive VitePress documentation website: `cd docs-site && pnpm dev`
