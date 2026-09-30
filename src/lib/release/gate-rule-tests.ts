/**
 * 门禁规则模块的单测覆盖审计。
 *
 * 背景：`gate-wiring.ts` 自己写明「规则只判断接线与引用是否成立，**不判断门禁本身的强度**」。
 * 接线只回答「门禁会不会跑」，不回答「门禁会不会响」——而本轮复核量到的事实是：
 * `check:perf` 的三格里**两格**从来没响过（sourcemap 那一格只判三种泄漏形态里的一种；
 * recharts 那一格在 Turbopack 生产产物里**结构性地不可能命中**，长期打印「未检测到」，
 * 却顶着「防懒加载回退」的名字），而它们从未响过这件事**没有任何机制会发现**。
 *
 * 仓库已有的判据是：**判定逻辑放在 `src/lib/**` 的纯函数规则模块里，脚本只负责 IO**
 * （读仓库、调用规则、打印、给退出码）。这个形态有一个可机械核对的副产品——
 * 规则模块有名字，而 vitest 的测试文件名以规则模块名为前缀，于是「规则模块有没有单测」
 * 成了一个**可判定的事实**。本模块把这条约定固化：
 *
 *   - 每个 `check:*` 门禁引用的每个 `src/lib` 规则模块，都必须存在以它为前缀的 `*.test.ts`；
 *   - **一条规则模块都没检出时报红**——提取规则模块靠的是读脚本文本，这个提取本身是启发式，
 *     而一个「因为提取得不对所以什么都没查到」的审计，必须出声而不是安静地报 0 项通过；
 *   - 判定逻辑内联在脚本里的门禁**不算错**，但必须被**计数并打印**出来：这个数是分母，
 *     隐去它就等于把「有 N 条门禁的强度没有被单测兜底」这件事藏起来。
 *
 * 本模块只判断「规则模块有没有单测」，不判断单测本身好不好——那是覆盖率工具的活。
 */

/** 一条门禁与其引用的规则模块。 */
export interface GateRuleRef {
  /** `package.json` 里的门禁名，如 `check:states`。 */
  name: string;
  /** 该门禁脚本引用的 `src/lib` 规则模块（仓库相对路径）。 */
  ruleModules: readonly string[];
}

export type GateRuleTestCode = "RULE_MODULE_UNTESTED" | "NO_RULE_MODULE_DETECTED";

export interface GateRuleTestIssue {
  code: GateRuleTestCode;
  /** 规则模块或门禁名。 */
  subject: string;
  message: string;
}

export interface GateRuleTestReport {
  errors: GateRuleTestIssue[];
  stats: {
    /** 门禁总数。 */
    totalGates: number;
    /** 引用了规则模块的门禁数。 */
    gatedGates: number;
    /** 判定逻辑内联在脚本里、强度没有被单测兜底的���禁数。 */
    inlineGates: number;
    /** 去重后的规则模块数。 */
    ruleModules: number;
  };
}

const RULE_MESSAGES: Record<GateRuleTestCode, string> = {
  RULE_MODULE_UNTESTED:
    "这条门禁的判定逻辑在 src/lib 规则模块里，但没有以它为前缀的单测——门禁的「会不会响」就没人兜底（check:perf 两格长期沉默就是先例）",
  NO_RULE_MODULE_DETECTED:
    "一条 src/lib 规则模块都没检出：本审计靠读脚本文本提取模块，提取失效应出声而不是报 0 项通过",
};

/**
 * 取路径最后一段作为「模块名」。
 *
 * 扩展名与 vitest 的 `.test` / `.spec` 中缀都要去掉：`state-rules.test.ts` 的模块名必须
 * 等于 `state-rules.ts` 的模块名，否则「规则模块有没有单测」这条判据会**永远为假**——
 * 而那正是本模块存在的目的（一条自己量不到东西的审计比没有审计更糟）。
 */
export function moduleNameOf(repoPath: string): string {
  const last = repoPath.split("/").pop() ?? repoPath;
  return last.replace(/\.tsx?$/, "").replace(/\.(test|spec)$/, "");
}

/**
 * 这个文件算不算「门禁的规则模块」。
 *
 * 排除 `types.ts` 与 `*.types.ts`：**它们装的是类型声明，不是判定逻辑**——类型正确性由
 * `tsc` 负责，给类型别名写单测是没有意义的问题（`src/lib/supabase/database.types.ts` 更是
 * 由数据库 schema 生成）。把它们算进来只会逼出「为了门禁而给类型文件硬凑一个测试」这种假活。
 *
 * 代价要说清楚：万一有人把判定逻辑塞进一个叫 `types.ts` 的文件，它会逃过这条审计。
 * 这个代价可接受——那样的文件按仓库约定本身就命名错了，而 ESLint 与 tsc 仍然覆盖它。
 */
export function isRuleModule(repoPath: string): boolean {
  const name = moduleNameOf(repoPath);
  return name !== "types" && !name.endsWith(".types");
}

/**
 * 规则模块 `src/lib/ui/state-rules.ts` 是否被某个 `*.test.ts` 覆盖。
 *
 * 判据是**文件名前缀**而不是精确同名：仓库里 `translation-values.ts` 的测试叫
 * `translation-values-check.test.ts`，`bundle-freshness.ts` 也没有同名测试。
 * 用 `startsWith` 匹配「以规则模块名开头」，宁可多认（多认的代价是这条门禁变松一点，
 * 而它本来就是兜底性质），也不要因为命名差异误报红。
 */
export function isRuleModuleCovered(ruleModule: string, testFiles: readonly string[]): boolean {
  const base = moduleNameOf(ruleModule);
  return testFiles.some((test) => {
    if (!test.endsWith(".test.ts") && !test.endsWith(".test.tsx")) return false;
    return moduleNameOf(test) === base || moduleNameOf(test).startsWith(`${base}-`);
  });
}

/** 审计「每个规则模块都有单测」这条约定。 */
export function auditGateRuleTests(input: {
  gates: readonly GateRuleRef[];
  /** 仓库里全部 `*.test.ts` / `*.test.tsx` 的相对路径。 */
  testFiles: readonly string[];
}): GateRuleTestReport {
  const errors: GateRuleTestIssue[] = [];
  const modules = new Set<string>();
  let inlineGates = 0;

  for (const gate of input.gates) {
    if (gate.ruleModules.length === 0) {
      inlineGates += 1;
      continue;
    }
    for (const ruleModule of gate.ruleModules) {
      if (isRuleModule(ruleModule)) modules.add(ruleModule);
    }
  }

  if (modules.size === 0) {
    errors.push({ code: "NO_RULE_MODULE_DETECTED", subject: "全部门禁", message: RULE_MESSAGES.NO_RULE_MODULE_DETECTED });
  }

  for (const ruleModule of [...modules].sort()) {
    if (isRuleModuleCovered(ruleModule, input.testFiles)) continue;
    errors.push({ code: "RULE_MODULE_UNTESTED", subject: ruleModule, message: RULE_MESSAGES.RULE_MODULE_UNTESTED });
  }

  return {
    errors,
    stats: {
      totalGates: input.gates.length,
      gatedGates: input.gates.length - inlineGates,
      inlineGates,
      ruleModules: modules.size,
    },
  };
}

/** 把问题列表格式化成多行文本（供 CLI 与单测断言）。 */
export function formatGateRuleTestIssues(issues: readonly GateRuleTestIssue[]): string {
  return issues
    .map((issue) => `❌ [${issue.code}] ${issue.subject}：${issue.message}`)
    .join("\n");
}
