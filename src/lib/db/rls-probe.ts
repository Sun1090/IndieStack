/**
 * `check:rls-probe` 的**判定**：什么情况下这道门禁该绿、该红、该跳过。
 *
 * IO（起 PostgreSQL 集群、跑 psql）在 `scripts/lib/rls-probe-check.js`。
 * 分家的理由不是洁癖：`check:gate-rule-tests` 的判据是「判定在 src/lib 纯函数里、
 * 脚本只做 IO」，而一条判定内联在脚本里的门禁，**它的「会不会响」没有任何人兜底**。
 * 本文件第一次跑全量门禁时就被那条审计判红（`INLINE_GATE_REINTRODUCED`），
 * 于是把判定搬到这里，顺带想清楚了一件此前没想的事——**见下面 `auditProbeInventory`**。
 *
 * ── 探针为什么不只需要「跑通」 ────────────────────────────────────────────
 *
 * 一个 `.sql` 探针文件只要不抛异常，psql 就退 0。这意味着下面两种文件**永远是绿的**：
 *
 *   1. 只 `probe.expect(...)` 登记期望、结尾忘了 `probe.verify(...)`：
 *      登记了一堆行，没有任何人读它们；psql 退 0，门禁打勾。
 *   2. 只 `probe.verify(...)` 而一条 `expect` 都没有：`probe.verify` 里那句
 *      `select count(*) into failures from probe.case where rows is distinct from want`
 *      在空表上的读数是 0，于是它打印「0 条全部符合期望」并正常返回。
 *
 * 两种都不是假想：第 2 种的形状和「策略全对」长得一模一样，而它其实什么都没验。
 * 所以本模块对每个探针文件要求 **`expect` 与 `verify` 同时存在且都不为 0**——
 * 这与仓库里那条「一个能悄悄涨回去的绿色数字，不如一条会红的规则」是同一个口径，
 * 只是把尺子量回了门禁自己身上。
 *
 * 计数的口径要写清：**注释里的 `probe.expect(` 不算**（`000_helpers.sql` 的注释与
 * 函数定义都出现过这两个词）。扫描前先把 `--` 行注释抹掉，否则探针文件里
 * 一句「用法：`probe.expect(...)`」就能把一个空壳文件撑成绿的。
 */

/** 探针必须的两个调用；顺序无关，数量各自 ≥ 1。 */
export const PROBE_REGISTER = "probe.expect(";
export const PROBE_ASSERT = "probe.verify(";

/**
 * 不算「探针」的 SQL 文件：一个是被测环境的替身，一个是夹具本身。
 *
 * `000_helpers.sql` 怎么排除都别扭——它**定义**了 `probe.expect` / `probe.verify`，
 * 按调用计数它是 1/1，看起来像个合格探针；但它没有一条真实用例，
 * 让它的「1 条用例」进入统计会把用例总数报虚。所以按文件角色排除，不按内容猜。
 */
export const NON_PROBE_FILES: readonly string[] = ["bootstrap.sql", "000_helpers.sql"];

/** 起集群要用的三个可执行文件。缺一个就没法验，不许假装验过。 */
export const REQUIRED_BINARIES: readonly string[] = ["initdb", "pg_ctl", "psql"];

/**
 * 「装了但不在 PATH 上」的常见位置（`*` 由调用方展开成一个目录层级）。
 *
 * 这一条来自一个具体的坑：GitHub 的 `ubuntu-latest` 镜像**自带** PostgreSQL，
 * 但 `psql` 在 `/usr/bin`，而 `initdb` / `pg_ctl` 在 `/usr/lib/postgresql/<ver>/bin`——
 * 后者不在 PATH 上。于是「本机缺二进制就跳过」这条友好设计在 CI 里变成**默认跳过**：
 * 门禁跑起来了、打了 ⚠️、退 0，而 RLS 这一层一次都没被执行验证过。
 * 这与仓库里记过的「check:docs 只存在于本地聚合」是同一类病：**跑了，但没验**。
 *
 * 所以判「缺不缺」之前先按这些位置找一个目录，找得到就把它接到 PATH 前面。
 */
export const POSTGRES_BIN_PATTERNS: readonly string[] = [
  "/opt/homebrew/opt/postgresql@*/bin",
  "/usr/local/opt/postgresql@*/bin",
  "/usr/lib/postgresql/*/bin",
  "/usr/pgsql-*/bin",
];

/**
 * 从候选目录里挑第一个**三件套齐全**的。
 *
 * 只挑「齐全」的而不是「有 initdb 就行」：混用两个 PostgreSQL 版本的服务端与客户端
 * 会在 `pg_ctl start` 之后以一句很难读的错误失败，而那句话看起来像探针自己的问题。
 */
export function pickBinDir(input: {
  /** 候选目录（已展开 `*` 的真实路径）。 */
  dirs: readonly string[];
  /** 该目录下是否存在某个可执行文件。 */
  hasBin: (dir: string, bin: string) => boolean;
  requiredBins?: readonly string[];
}): string | null {
  const required = input.requiredBins ?? REQUIRED_BINARIES;
  for (const dir of input.dirs) {
    if (required.every((bin) => input.hasBin(dir, bin))) return dir;
  }
  return null;
}

/**
 * 把带 `*` 的模式展开：`byDir` 返回某个父目录下的全部子项名。
 *
 * `*` 只支持「某个路径段内的前缀通配」（`postgresql@*` / `*`），不支持跨段。
 * 第一版把「`*` 之前的字符串」当成父目录，于是 `postgresql@*` 被切成了
 * `/opt/homebrew/opt/postgresql@`——一个不存在的目录，发现逻辑**静默什么都没找到**，
 * 而这条代码的整个意义就是「找到了就用」。是本机实跑（PATH 里去掉 Homebrew）抓到的。
 *
 * 保留 `patterns` 的书写顺序（前面的先试），只在**同一个模式内部**按名字倒序：
 * 这样 `postgresql@16` 排在 `postgresql@14` 前面，而 `/usr/lib` 与 `/opt/homebrew`
 * 的先后由常量顺序决定，不交给字符串比较去猜。
 */
export function expandBinPatterns(
  patterns: readonly string[],
  byDir: (parentDir: string) => readonly string[],
): string[] {
  const out: string[] = [];
  for (const pattern of patterns) {
    const segments = pattern.split("/");
    const starAt = segments.findIndex((segment) => segment.includes("*"));
    if (starAt === -1) {
      out.push(pattern);
      continue;
    }
    const parent = segments.slice(0, starAt).join("/") || "/";
    const prefix = segments[starAt].replace(/\*.*$/, "");
    const rest = segments.slice(starAt + 1);
    const children = [...byDir(parent)].filter((child) => child.startsWith(prefix)).sort().reverse();
    for (const child of children) {
      out.push([parent, child, ...rest].join("/").replace(/\/+/g, "/"));
    }
  }
  return out;
}


export type PrerequisiteAction = "proceed" | "skip" | "fail";

export interface PrerequisiteDecision {
  action: PrerequisiteAction;
  /** 直接打印给人看的一段话；`proceed` 时为空串。 */
  message: string;
}

/**
 * 本机能不能跑这道门禁。
 *
 * 缺二进制时默认**跳过**（本机开发者不一定装了 Postgres），但两种情况下按失败处理：
 *
 *   - `RLS_PROBE_REQUIRE=1`：显式要求强制；
 *   - `CI=true`：**这是默认值，不是可选项。** 理由是本仓库记过的那类病——门禁「跑了但没验」。
 *     CI 里如果只是跳过，日志里那一行 ⚠️ 会被后面几十行 ✅ 淹没，而 RLS 这一层
 *     整轮没有执行验证这件事没有任何机制会发现。真要跳过得写进豁免表并说明替代覆盖。
 *
 * 跳过的措辞是判定的一部分，不是日志美化：这句话必须点明**这一层这次没有被验证**，
 * 只写「已跳过」会让读日志的人以为 RLS 验过了。所以它不是随手拼的字符串，
 * 由单测钉住。
 */
export function decidePrerequisite(input: {
  missingBins: readonly string[];
  /** `process.env.RLS_PROBE_REQUIRE` 的原始值。 */
  requireFlag: string | undefined;
  /** `process.env.CI` 的原始值（GitHub Actions 设为 `true`）。 */
  ciFlag?: string | undefined;
}): PrerequisiteDecision {
  if (input.missingBins.length === 0) return { action: "proceed", message: "" };

  const head =
    `check:rls-probe 无法运行：缺少 ${input.missingBins.join(" / ")}（本机没有 Postgres 服务端工具）。`;
  const tail = "RLS 策略这一层这次**没有被执行验证**，只有 check:rls 的静态扫描。";

  if (input.requireFlag === "1") {
    return { action: "fail", message: `${head}\n${tail}\nRLS_PROBE_REQUIRE=1，按失败处理。` };
  }
  if (input.ciFlag === "true") {
    return {
      action: "fail",
      message:
        `${head}\n${tail}\nCI 里不允许跳过：请装 PostgreSQL 服务端工具` +
        `（apt-get install -y postgresql，二进制在 /usr/lib/postgresql/*/bin；` +
        `本脚本会自己把它们接入 PATH）。`,
    };
  }
  return { action: "skip", message: `${head}\n${tail}` };
}

/** 去掉 `--` 行注释（不处理块注释：探针文件里没人用它装用例）。 */
export function stripLineComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

/**
 * 一个 SQL 文本里登记了多少条用例。
 *
 * 只数代码位，不数注释——理由见文件头。`probe.expect(` 每次调用对应
 * `probe.case` 里一行，所以这就是「这个文件到底验了几件事」。
 */
export function countExpectations(sql: string): number {
  const code = stripLineComments(sql);
  return code.split(PROBE_REGISTER).length - 1;
}

/** 该文件是否调用了断言入口。 */
export function hasAssertion(sql: string): boolean {
  return stripLineComments(sql).includes(PROBE_ASSERT);
}

export type ProbeInventoryCode =
  | "NO_PROBES"
  | "MISSING_HELPERS"
  | "PROBE_WITHOUT_ASSERT"
  | "PROBE_WITHOUT_EXPECTATION";

export interface ProbeInventoryIssue {
  code: ProbeInventoryCode;
  /** 文件名（不是整条路径：报错要能一眼对上是哪个文件）。 */
  subject: string;
  message: string;
}

export interface ProbeInventoryReport {
  issues: ProbeInventoryIssue[];
  stats: {
    /** 真正参与取证的探针文件数。 */
    probeFiles: number;
    /** 全部探针登记的用例条数之和。 */
    cases: number;
  };
}

const INVENTORY_MESSAGES: Record<ProbeInventoryCode, string> = {
  NO_PROBES: "supabase/tests/ 下一个探针都没有——这道门禁会永远是绿的，等于没做",
  MISSING_HELPERS:
    "缺少 000_helpers.sql：探针没有 probe.expect / probe.verify 可用，跑起来会是「函数不存在」而不是策略问题",
  PROBE_WITHOUT_ASSERT:
    "这个探针只登记期望、没调用 probe.verify：登记的行没有人读，psql 仍然退 0，门禁会一直绿",
  PROBE_WITHOUT_EXPECTATION:
    "这个探针调了 probe.verify 却一条 expect 都没有：空表上 failures=0，它会打印「0 条全部符合期望」并放行",
};

/**
 * 盘点 `supabase/tests/` 里到底有多少真在断言的东西。
 *
 * `files` 是「全部 .sql 文件」而不是「探针文件」——是否属于探针由本函数按
 * `NON_PROBE_FILES` 判，调用方不要先筛一遍（筛在调用方就意味着判据散了两处）。
 */
export function auditProbeInventory(
  files: readonly { name: string; text: string }[],
): ProbeInventoryReport {
  const issues: ProbeInventoryIssue[] = [];
  const names = new Set(files.map((file) => file.name));

  if (!names.has("000_helpers.sql")) {
    issues.push({ code: "MISSING_HELPERS", subject: "000_helpers.sql", message: INVENTORY_MESSAGES.MISSING_HELPERS });
  }

  const probes = files.filter((file) => !NON_PROBE_FILES.includes(file.name));
  let cases = 0;

  for (const probe of probes) {
    const registered = countExpectations(probe.text);
    cases += registered;
    if (!hasAssertion(probe.text)) {
      issues.push({ code: "PROBE_WITHOUT_ASSERT", subject: probe.name, message: INVENTORY_MESSAGES.PROBE_WITHOUT_ASSERT });
    }
    if (registered === 0) {
      issues.push({
        code: "PROBE_WITHOUT_EXPECTATION",
        subject: probe.name,
        message: INVENTORY_MESSAGES.PROBE_WITHOUT_EXPECTATION,
      });
    }
  }

  if (probes.length === 0) {
    issues.push({ code: "NO_PROBES", subject: "supabase/tests", message: INVENTORY_MESSAGES.NO_PROBES });
  }

  return { issues, stats: { probeFiles: probes.length, cases } };
}

export interface ProbeRunSummary {
  ok: boolean;
  message: string;
}

/**
 * 收尾读数：应用了多少迁移、跑了多少探针、几个没过。
 *
 * 失败时的措辞刻意带上分母（`n/m`）——「3 个探针不通过」在 4 个文件的仓库里
 * 和 40 个文件的仓库里是两件事，而只报分子的日志读不出这个差别。
 */
export function summarizeProbeRun(input: {
  migrations: number;
  probeFiles: number;
  cases: number;
  failures: number;
}): ProbeRunSummary {
  const { migrations, probeFiles, cases, failures } = input;
  if (failures > 0) {
    return {
      ok: false,
      message: `RLS 策略执行取证失败：${failures}/${probeFiles} 个探针不通过（共 ${cases} 条用例，${migrations} 个迁移已应用）`,
    };
  }
  return {
    ok: true,
    message: `RLS 策略执行取证通过：${migrations} 个迁移应用成功，${probeFiles} 个探针 / ${cases} 条用例在真库上跑通`,
  };
}

/** 把盘点问题格式化成多行文本（供 CLI 与单测断言）。 */
export function formatProbeIssues(issues: readonly ProbeInventoryIssue[]): string {
  return issues.map((issue) => `❌ [${issue.code}] ${issue.subject}：${issue.message}`).join("\n");
}

/**
 * ── 静态策略集 ↔ 真库策略集 的对账 ────────────────────────────────────────────
 *
 * `check:rls` 读迁移文本，说出「应有 38 条策略、每条都带 using / with check」。
 * 但这句话到 2026-10-31 为止**从来没有和数据库里真有的策略比过一次**——
 * 门禁自己读自己，读法错了也照样绿（`rls-coverage.ts` 的文件头就记着一次：
 * 策略名正则把带空格的名字截成一个词，同一张表的策略互相覆盖，门禁一直绿）。
 *
 * 现在这条探针把两侧都拿到手：左侧是迁移文本经 `extractEffectivePolicies` 的结果，
 * 右侧是 `pg_policies` 在应用完全部真实迁移之后的读数。两者比对三件事：
 * 有没有对方没有的策略、命令是否一致、`using` / `with check` 的有无是否一致
 * （表达式文本不比——PostgreSQL 会把 `auth.uid()` 重排成 `(auth.uid() = user_id)`，
 *  比文本只会比出噪音；而「有没有」正是静态门禁唯一断言的东西）。
 *
 * **只比 `public` schema**：`storage.objects` 的策略由 Supabase 初始化脚本创建，
 * 本仓库的 bootstrap 替身里没有那部分，比它只会比出替身的边界，不是缺陷。
 */
export interface PolicyFingerprint {
  /** 形如 `public.projects`。 */
  table: string;
  name: string;
  /** 小写的 `select` / `insert` / `update` / `delete` / `all`。 */
  command: string;
  /** 已排序去重的角色名。 */
  roles: string;
  hasUsing: boolean;
  hasCheck: boolean;
}

export function policyKey(policy: Pick<PolicyFingerprint, "table" | "name">): string {
  return `${policy.table}\u0000${policy.name}`;
}

/**
 * 角色列表归一化：小写、排序、去重、逗号连接。
 *
 * 比对的是字符串，所以两边必须同一种写法——PostgreSQL 的 `pg_policies.roles` 是
 * `{anon,authenticated}` 这种**按字母序**的数组，而迁移文本里写的是 `to authenticated`。
 * 不归一化就会出现「同一条策略被判成不一致」的误报，而误报会让这条门禁被关掉。
 */
export function normalizeRoles(roles: readonly string[] | string): string {
  const list = typeof roles === "string" ? roles.split(",").filter(Boolean) : roles;
  return [...new Set(list.map((role) => role.trim().toLowerCase()).filter(Boolean))].sort().join(",");
}

/** 从 `extractEffectivePolicies` 的结果转成指纹（结构化入参，避免与安全模块互引）。 */
export function fingerprintFromStatement(statement: {
  table: string;
  name: string;
  command: string;
  roles: readonly string[];
  using: string | null;
  withCheck: string | null;
}): PolicyFingerprint {
  return {
    table: statement.table,
    name: statement.name,
    command: statement.command.toLowerCase(),
    roles: normalizeRoles(statement.roles),
    hasUsing: statement.using !== null,
    hasCheck: statement.withCheck !== null,
  };
}

/** 从 `pg_policies` 的一行转成指纹。 */
export function fingerprintFromDbRow(row: {
  table: string;
  name: string;
  command: string;
  roles: readonly string[];
  hasUsing: boolean;
  hasCheck: boolean;
}): PolicyFingerprint {
  return {
    table: row.table,
    name: row.name,
    command: row.command.toLowerCase(),
    roles: normalizeRoles(row.roles),
    hasUsing: row.hasUsing,
    hasCheck: row.hasCheck,
  };
}

export interface PolicySetDiff {
  /** 只在真库里有的策略（静态提取漏了，或迁移里有动态 SQL）。 */
  onlyInDb: string[];
  /** 只在静态结果里有的策略（迁移写了但库里没有，或静态解析错认）。 */
  onlyInStatic: string[];
  /** 两边都有但字段不一致。 */
  mismatched: { key: string; detail: string }[];
}

export function comparePolicySets(
  expected: readonly PolicyFingerprint[],
  actual: readonly PolicyFingerprint[],
): PolicySetDiff {
  const expectedMap = new Map(expected.map((p) => [policyKey(p), p]));
  const actualMap = new Map(actual.map((p) => [policyKey(p), p]));
  const diff: PolicySetDiff = { onlyInDb: [], onlyInStatic: [], mismatched: [] };

  for (const key of actualMap.keys()) {
    if (!expectedMap.has(key)) diff.onlyInDb.push(key.replace("\u0000", " / "));
  }
  for (const [key, policy] of expectedMap) {
    const counterpart = actualMap.get(key);
    if (!counterpart) {
      diff.onlyInStatic.push(key.replace("\u0000", " / "));
      continue;
    }
    const fields: string[] = [];
    if (counterpart.command !== policy.command) {
      fields.push(`command 静态=${policy.command} 真库=${counterpart.command}`);
    }
    // 入参可能没过 `fingerprintFrom*`（单测与将来别的调用方都可能直接构造），
    // 所以这里自己归一化一次：顺序不同不算不一致，否则会逼着人来关掉这条门禁。
    if (normalizeRoles(counterpart.roles) !== normalizeRoles(policy.roles)) {
      fields.push(`roles 静态=[${policy.roles}] 真库=[${counterpart.roles}]`);
    }
    if (counterpart.hasUsing !== policy.hasUsing) {
      fields.push(`using 静态=${policy.hasUsing} 真库=${counterpart.hasUsing}`);
    }
    if (counterpart.hasCheck !== policy.hasCheck) {
      fields.push(`with check 静态=${policy.hasCheck} 真库=${counterpart.hasCheck}`);
    }
    if (fields.length > 0) {
      diff.mismatched.push({ key: key.replace("\u0000", " / "), detail: fields.join("；") });
    }
  }

  return diff;
}

export function isPolicySetAligned(diff: PolicySetDiff): boolean {
  return diff.onlyInDb.length === 0 && diff.onlyInStatic.length === 0 && diff.mismatched.length === 0;
}

/** 把对账结果格式化成多行文本。 */
export function formatPolicySetDiff(diff: PolicySetDiff): string {
  const lines: string[] = [];
  for (const key of diff.onlyInDb) lines.push(`❌ 只在真库：${key}（静态提取漏了这条策略）`);
  for (const key of diff.onlyInStatic) lines.push(`❌ 只在静态：${key}（迁移里有、库里没有）`);
  for (const item of diff.mismatched) lines.push(`❌ 不一致：${item.key}——${item.detail}`);
  return lines.join("\n");
}
