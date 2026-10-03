/**
 * 规则模块的「变异核对」工具：把判定函数中性化，看它自己的套件会不会红。
 *
 * **为什么要有这个工具**：#194 用手写脚本量过 12 个规则模块，结论是「有单测」在本仓库里
 * 等于「单测会失败」。但那个测法当时是**一次性脚本**，里面有三次测量事故，其中一次正是
 * 「ANSI 颜色码吃掉了 grep → 把 6 个全部变红的模块读成全部存活」。
 * 也就是说**结论是对的，过程里藏着一个会说出相反结论的错误**，
 * 而结论不会被记录，过程会——于是下一次有人重做这件事时，很可能再踩一次。
 *
 * 所以这里把过程固化成可复用、可单测的两半：
 *   - `neuterFunction`：纯字符串变换，把判定函数体变成「永远判合格」；
 *   - `summarizeFalsification`：读回测试输出并给出结论，**读不出数字时返回 `unreadable`
 *     而不是「存活」**——那正是那次事故的形状。
 *
 * **刻意不做成常驻门禁**：这个测法要**改源码再跑测试**，放进 CI 既慢又不自洽
 * （一条门禁靠临时改坏别的文件来工作）。它的正确形态是**按需跑的取证**，
 * 与 #194 的结论一致：`pnpm falsify:rules` 手动跑，产物是上面那张表。
 */

/** 一条待核对的判定：`file` 里的 `function` 被中性化后，跑 `testFile` 看红不红。 */
export interface FalsificationTarget {
  /** 规则模块（仓库相对路径）。 */
  file: string;
  /** 判定函数名。必须是该模块**唯一的报出问题**的入口。 */
  function: string;
  /**
   * 中性化语句：插到函数体第一行立即 return 的那句话。
   * 约定是那个「永远判合格」的值（空数组 / 空报告）——**不是**让函数崩掉。
   */
  neuteredReturn: string;
  /** 该模块自己的测试文件（仓库相对路径）。 */
  testFile: string;
}

/**
 * 已用本工具核对过的判定。
 *
 * **只登记真的跑过红的目标**：登记表不是「打算核对」的清单，而是「核对过」的证据。
 * #194 手工核对过的另外 12 个模块没有登记——它们的结论是真的，但**没有被这套工具复核过**，
 * 写进表里会让「跑一遍这张表」变成一次没有证据的复述。
 */
export const RULE_FALSIFICATION_TARGETS: readonly FalsificationTarget[] = [
  {
    file: "src/lib/security/security-config.ts",
    function: "inspectTrackedFiles",
    neuteredReturn: "return [];",
    testFile: "src/lib/security/security-config.test.ts",
  },
  {
    file: "src/lib/security/security-config.ts",
    function: "inspectEnvFile",
    neuteredReturn: "return [];",
    testFile: "src/lib/security/security-config.test.ts",
  },
  {
    file: "src/lib/security/security-config.ts",
    function: "inspectClientModules",
    neuteredReturn: "return [];",
    testFile: "src/lib/security/security-config.test.ts",
  },
  {
    file: "src/lib/security/security-config.ts",
    function: "inspectWorkflowPermissions",
    neuteredReturn: "return [];",
    testFile: "src/lib/security/security-config.test.ts",
  },
  {
    file: "src/lib/security/security-config.ts",
    function: "inspectSecurityGateFiles",
    neuteredReturn: "return [];",
    testFile: "src/lib/security/security-config.test.ts",
  },
  {
    file: "src/lib/security/security-config.ts",
    function: "inspectProductionMockSettings",
    neuteredReturn: "return [];",
    testFile: "src/lib/security/security-config.test.ts",
  },
  {
    file: "src/lib/security/rls-coverage.ts",
    function: "inspectRlsCoverage",
    neuteredReturn: "return [];",
    testFile: "src/lib/security/rls-coverage.test.ts",
  },
  {
    file: "src/lib/security/security-definer-grants.ts",
    function: "inspectSecurityDefinerGrants",
    neuteredReturn: "return [];",
    testFile: "src/lib/security/security-definer-grants.test.ts",
  },
  {
    file: "src/lib/security/secrets-scan-policy.ts",
    function: "auditSecretsScanPolicy",
    neuteredReturn: "return { issues: [], checks: 0 };",
    testFile: "src/lib/security/secrets-scan-policy.test.ts",
  },
  {
    file: "src/lib/release/roadmap-entries.ts",
    function: "inspectRoadmapEntries",
    neuteredReturn: "return [];",
    testFile: "src/lib/release/roadmap-entries.test.ts",
  },
  {
    file: "src/lib/docs/progress-ledger.ts",
    function: "auditProgressLedger",
    neuteredReturn: "return { issues: [], entries: [] };",
    testFile: "src/lib/docs/progress-ledger.test.ts",
  },
  {
    file: "src/lib/ci/workflow-policy.ts",
    function: "auditWorkflowPolicy",
    neuteredReturn:
      "return { issues: [], workflows: 0, jobs: 0, actions: 0 };",
    testFile: "src/lib/ci/workflow-policy.test.ts",
  },
  {
    file: "src/lib/i18n/dynamic-keys.ts",
    function: "auditDynamicKeys",
    neuteredReturn:
      "return { issues: [], stats: { contracts: 0, locales: 0, values: 0, templates: 0 } };",
    testFile: "src/lib/i18n/dynamic-keys.test.ts",
  },
  {
    file: "src/lib/i18n/action-errors.ts",
    function: "auditActionErrorTranslation",
    neuteredReturn: 'return { issues: [], codes: [], keyCounts: {} };',
    testFile: "src/lib/i18n/action-errors.test.ts",
  },
  {
    file: "src/lib/docs/doc-links.ts",
    function: "auditDocLinks",
    neuteredReturn:
      "return { errors: [], stats: { files: 0, internalLinks: 0, broken: 0 } };",
    testFile: "src/lib/docs/doc-links.test.ts",
  },
  {
    file: "src/lib/docs/doc-commands.ts",
    function: "auditDocCommands",
    neuteredReturn:
      "return { errors: [], stats: { files: 0, commands: 0, resolved: 0, excluded: 0, binariesRead: false } };",
    testFile: "src/lib/docs/doc-commands.test.ts",
  },
  {
    file: "src/lib/release/hook-wiring.ts",
    function: "auditHookWiring",
    neuteredReturn: "return { issues: [], checkedCommands: 0, hookNames: [] };",
    testFile: "src/lib/release/hook-wiring.test.ts",
  },
  {
    file: "src/lib/i18n/glossary.ts",
    function: "auditGlossary",
    neuteredReturn:
      "return { issues: [], matchedTerms: 0, checkedPairs: 0, exempted: [], approvedUsage: {} };",
    testFile: "src/lib/i18n/glossary.test.ts",
  },
  {
    file: "src/lib/i18n/translation-values.ts",
    function: "auditTranslationValues",
    neuteredReturn: "return { issues: [], checkedValues: 0, exemptedKeys: [] };",
    testFile: "src/lib/i18n/translation-values.test.ts",
  },
  {
    file: "src/lib/security/client-write-policies.ts",
    function: "inspectClientWritePolicies",
    neuteredReturn: "return [];",
    testFile: "src/lib/security/client-write-policies.test.ts",
  },
  {
    file: "src/lib/security/rate-limit-policy.ts",
    function: "auditRateLimits",
    neuteredReturn: "return [];",
    testFile: "src/lib/security/rate-limit-policy.test.ts",
  },
  {
    file: "src/lib/security/query-error-channel.ts",
    function: "inspectQueryErrorChannel",
    neuteredReturn: "return [];",
    testFile: "src/lib/security/query-error-channel.test.ts",
  },
  {
    file: "src/lib/release/release-tag-policy.ts",
    function: "auditReleaseTag",
    neuteredReturn: "return { issues: [], checks: 0 };",
    testFile: "src/lib/release/release-tag-policy.test.ts",
  },
  {
    file: "src/lib/release/gate-wiring.ts",
    function: "auditGateWiring",
    neuteredReturn:
      'return { issues: [], gates: [], localGates: [], ciGates: [], exempted: [], referencedScripts: [], workflows: [], checklistWorkflows: [] };',
    testFile: "src/lib/release/gate-wiring.test.ts",
  },
];

export interface MutationResult {
  source: string;
  /** 是否真的改动了。`false` 表示没找到函数或函数体起点——**不允许静默跳过**。 */
  changed: boolean;
}

/**
 * 在 `functionName` 的函数体第一行插入 `statement`。
 *
 * 只认 `export function NAME(`：本工具的用途是中性化**导出的判定入口**，
 * 而匿名回调、内部 helper 不在范围内——把它们算进来会让「找不到函数」变成常态，
 * 那样这张表就退化成一份没人看的清单。
 *
 * 函数体起点靠**括号配对**找，不是靠「下一行以 `{` 开头」：
 * 签名跨行、带默认值、带泛型都会让后者指错位置（而指错位置的代价是
 * 「变异打上了但打在别人身上」，比没打上更难发现）。
 */
export function neuterFunction(
  source: string,
  functionName: string,
  statement: string,
): MutationResult {
  const signature = new RegExp(`export\\s+function\\s+${escapeForRegExp(functionName)}\\s*\\(`);
  const match = signature.exec(source);
  if (match === null) return { source, changed: false };

  let depth = 0;
  let cursor = match.index + match[0].length - 1;
  let bodyStart = -1;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        bodyStart = source.indexOf("{", cursor);
        break;
      }
    }
    cursor += 1;
  }
  if (bodyStart === -1) return { source, changed: false };

  const mutated = `${source.slice(0, bodyStart + 1)}\n  ${statement}\n${source.slice(bodyStart + 1)}`;
  return { source: mutated, changed: true };
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ANSI_PATTERN = /\[[0-9;]*[A-Za-z]/g;

/**
 * 去掉 ANSI 转义序列。
 *
 * **这不是洁癖**：vitest 的真实输出里 `Tests` 与数字之间夹着转义序列，
 * 于是 `/Tests\s+(\d+)\s+failed/` 匹配不到，**六个全部变红的模块会被读成六个全部存活**。
 * #194 那次手工测量就栽在这里，本轮第一次跑批量核对又栽了一次（六个模块先报「全部存活」，
 * 手工复核其中一条才发现是 8 条红）。**一个会说出相反结论的读数比没有读数更贵。**
 */
export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

export type FalsificationVerdict = "bites" | "survived" | "unreadable";

export interface FalsificationOutcome {
  target: FalsificationTarget;
  /** 变红的用例数；`null` 表示输出里读不出这个数。 */
  failedTests: number | null;
  passedTests: number | null;
  verdict: FalsificationVerdict;
}

/**
 * 读回 vitest 输出并给出结论。
 *
 * **失败封闭的方向选在这里**：`failedTests` 读不出来时给 `unreadable`，
 * 而 `unreadable` **不等于** `survived`。把「不知道」读成「没问题」是那次事故的形状，
 * 所以这一格必须与「存活」分开，让它无法被顺手当成通过。
 */
export function summarizeFalsification(
  target: FalsificationTarget,
  rawOutput: string,
): FalsificationOutcome {
  const output = stripAnsi(rawOutput);
  // 先取 `Tests …` 那一行，再在**这一行里**分别找两个数字。
  // 早先写成两个独立的 `/Tests\s+(\d+)\s+(failed|passed)/`，于是
  // 「8 failed | 6 passed」读得出 failed 却读不出 passed，而全绿输出里根本没有
  // 「N failed」这三个字——于是「全绿」与「读不出」被混成同一格。
  const summary = /Tests\s+([^\n]*)/.exec(output)?.[1] ?? null;
  const failedTests = summary === null ? null : (/(\d+)\s+failed/.exec(summary)?.[1] ?? null);
  const passedTests = summary === null ? null : (/(\d+)\s+passed/.exec(summary)?.[1] ?? null);
  const failedCount = failedTests === null ? null : Number(failedTests);
  const passedCount = passedTests === null ? null : Number(passedTests);
  // 「读不出」的判据是**两个数字都没有**：全绿时 failed 缺失但 passed 在，
  // 那是一个真结论（survived），不是不知道。
  const verdict: FalsificationVerdict =
    failedCount === null && passedCount === null
      ? "unreadable"
      : (failedCount ?? 0) > 0
        ? "bites"
        : "survived";
  return {
    target,
    failedTests: failedCount,
    passedTests: passedCount,
    verdict,
  };
}

/** 结论表的一行；`unreadable` 显式写出来，不与「存活」混排。 */
export function formatFalsificationOutcome(outcome: FalsificationOutcome): string {
  const { target, failedTests, passedTests, verdict } = outcome;
  const reading =
    failedTests === null
      ? "输出里读不出「N failed」——**这一格不等于通过**"
      : `${failedTests} 条变红${passedTests === null ? "" : ` / ${passedTests} 条通过`}`;
  const mark = verdict === "bites" ? "✅ 会红" : verdict === "survived" ? "❌ 存活" : "⚠️ 读不出";
  return `${mark} ${target.file} → ${target.function}()：${reading}`;
}