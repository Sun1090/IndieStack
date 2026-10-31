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

export type PrerequisiteAction = "proceed" | "skip" | "fail";

export interface PrerequisiteDecision {
  action: PrerequisiteAction;
  /** 直接打印给人看的一段话；`proceed` 时为空串。 */
  message: string;
}

/**
 * 本机能不能跑这道门禁。
 *
 * 缺二进制时默认**跳过**（本机开发者不一定装了 Postgres），
 * 但 `RLS_PROBE_REQUIRE=1` 时按失败处理（CI 里必须设，否则 RLS 这层永远没人验）。
 *
 * 跳过的措辞是判定的一部分，不是日志美化：这句话必须点明**这一层这次没有被验证**，
 * 只写「已跳过」会让读日志的人以为 RLS 验过了。所以它不是随手拼的字符串，
 * 由单测钉住。
 */
export function decidePrerequisite(input: {
  missingBins: readonly string[];
  /** `process.env.RLS_PROBE_REQUIRE` 的原始值。 */
  requireFlag: string | undefined;
}): PrerequisiteDecision {
  if (input.missingBins.length === 0) return { action: "proceed", message: "" };

  const head =
    `check:rls-probe 无法运行：缺少 ${input.missingBins.join(" / ")}（本机没有 Postgres 服务端工具）。`;
  const tail = "RLS 策略这一层这次**没有被执行验证**，只有 check:rls 的静态扫描。";

  if (input.requireFlag === "1") {
    return { action: "fail", message: `${head}\n${tail}\nRLS_PROBE_REQUIRE=1，按失败处理。` };
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
