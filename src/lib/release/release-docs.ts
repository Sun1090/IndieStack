/**
 * 发布文档门禁的规则本体。
 *
 * 背景：这条门禁原先内联在 `scripts/check-release-docs.js`（36 行），它只做两件事：
 * ①「当前 `package.json` 版本对应的三份发布文档存在吗」；②「几份文档里各含某几个关键词吗」。
 * 于是**历史版本的发布证据完全不在它的视野里**——而那恰恰是**发布审计真正要读的东西**。
 * 实测（2026-09-30）：删掉 `docs/operations/production-smoke-v0.9.0.md`，
 * 门禁输出仍然是 `✅ release documentation checks passed (v0.11.0, 7 artifacts)`。
 *
 * 本仓库其实**刻意**维护着一套完整矩阵：v0.6.0–v0.11.0 每个版本各三份
 * （release / rollback / production-smoke），6 × 3 = 18 份。这个「三族覆盖同一批版本」的性质
 * 是**可判定的**，而且删掉其中任何一份都会破坏它——所以本模块把它变成规则。
 *
 * **为什么不顺带要求「CHANGELOG 里的每个已发布版本都有这三份文档」**：
 * CHANGELOG 声明了 11 个已发布版本，而这 18 份文档只覆盖 v0.6.0 之后的 6 个。
 * 0.1.0–0.5.0 没有，**理由与 tag 台账里写的是同一条**（标签纪律在那时还不存在，
 * 见 `MISSING_TAG_LEDGER`）——把这条理由在这里**再抄一遍**，就是本项目反复在消灭的那种
 * 「同一份数据有两个来源」。所以本模块只判**三族自洽**（不多不少、互相一致），
 * 跨到 CHANGELOG 的那一格**刻意不做**，并在这里写明它没做。
 *
 * 关键词判据沿用原样（`includes` 子串），**刻意不升级成语义判据**：这批文档的关键词是
 * 「这一节必须在」的检查点，子串足够，而语义判断会变成一条没人能反驳也修不动的门禁。
 */

export type ReleaseDocsCode =
  | "RELEASE_DOCS_MISSING_FILE"
  | "RELEASE_DOCS_MISSING_NEEDLE"
  | "RELEASE_DOCS_VERSION_FAMILY_MISMATCH";

export interface ReleaseDocsIssue {
  code: ReleaseDocsCode;
  subject: string;
  message: string;
}

export interface ReleaseDocsInput {
  /** `package.json` 的当前版本。 */
  version: string;
  /** `docs/operations/` 下实际存在的文件名（如 `production-smoke-v0.9.0.md`）。 */
  docFiles: readonly string[];
  /** 文档内容：键为仓库相对路径；值拿不到内容的键视为空串。 */
  contents: Readonly<Record<string, string>>;
  /** 与版本无关、每次发布都必须存在的固定文档。 */
  fixedFiles?: readonly string[];
  /** 关键词契约：文档路径 → 必须出现的子串。 */
  needles?: Readonly<Record<string, readonly string[]>>;
  /** 三族文档的文件名模板，`{v}` 会被替换成版本号。 */
  families?: readonly string[];
}

/** 三族模板：release / rollback / production-smoke。 */
export const DOC_FAMILIES = [
  "release-runbook-v{v}.md",
  "rollback-runbook-v{v}.md",
  "production-smoke-v{v}.md",
] as const;

/** 默认固定文档。 */
export const FIXED_RELEASE_FILES = [
  ".github/RELEASE_CHECKLIST.md",
  "CHANGELOG.md",
  "README.md",
  "README.zh-CN.md",
] as const;

/** 默认关键词契约（沿用历史口径，键为仓库相对路径）。 */
export const RELEASE_NEEDLES: Readonly<Record<string, readonly string[]>> = {
  "docs/operations/release-runbook-v{v}.md": [
    "pnpm verify:build",
    "pnpm test:e2e",
    "pnpm audit",
    "停止条件",
  ],
  "docs/operations/rollback-runbook-v{v}.md": ["不自动回滚数据库", "health", "前向修复迁移"],
  "docs/operations/production-smoke-v{v}.md": ["/api/health", "租户数据隔离", "回滚探针"],
  "CHANGELOG.md": ["[Unreleased]", "[{v}]"],
  ".github/RELEASE_CHECKLIST.md": ["v{v}", "runbook-v{v}", "rollback-runbook-v{v}"],
  "README.md": ["pnpm verify:build", "production smoke", "rollback", "smoke"],
  "README.zh-CN.md": ["pnpm verify:build", "生产冒烟", "回滚", "smoke"],
};

const DOC_DIR = "docs/operations/";

/**
 * 模板 → 前缀 / 后缀。`production-smoke-v{v}.md` → `["production-smoke-v", ".md"]`。
 *
 * **不能**用 `template.replace("{v}", "")` 得到一个「中缀」再拿 `startsWith` 去比：
 * 那样得到的是 `production-smoke-v.md`，而真实文件名是 `production-smoke-v0.9.0.md`
 * ——**它根本不是前缀**，于是整族永远匹配不上、这道判据永远空转。
 * （这个洞是单测抓到的：模板里 `{v}` 在中间时，删掉它并不会留下一个前缀。）
 */
function splitTemplate(template: string): { prefix: string; suffix: string } {
  const at = template.indexOf("{v}");
  if (at === -1) return { prefix: template, suffix: "" };
  return { prefix: template.slice(0, at), suffix: template.slice(at + 3) };
}

/** 文件名是否匹配该模板；匹配则返回版本号，否则 null。 */
export function versionOfDocName(fileName: string, families: readonly string[]): string | null {
  for (const template of families) {
    const { prefix, suffix } = splitTemplate(template);
    if (!fileName.startsWith(prefix) || !fileName.endsWith(suffix)) continue;
    if (fileName.length < prefix.length + suffix.length) continue;
    const version = fileName.slice(prefix.length, fileName.length - suffix.length);
    if (/^\d+\.\d+\.\d+$/.test(version)) return version;
  }
  return null;
}

/** 每个模板覆盖了哪些版本。 */
function versionsByFamily(
  docFiles: readonly string[],
  families: readonly string[],
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>(families.map((template) => [template, new Set<string>()]));
  for (const file of docFiles) {
    for (const template of families) {
      const version = versionOfDocName(file, [template]);
      if (version !== null) out.get(template)!.add(version);
    }
  }
  return out;
}

export interface ReleaseDocsReport {
  errors: ReleaseDocsIssue[];
  stats: {
    version: string;
    /** 三族共同覆盖的版本数。 */
    coveredVersions: number;
    /** 三族里的文件总数。 */
    docFiles: number;
  };
}

/** 当前版本必须存在的那三份 + 固定四份，是否都在。 */
function missingRequiredFiles(input: ReleaseDocsInput, families: readonly string[]): ReleaseDocsIssue[] {
  const present = new Set(input.docFiles);
  const issues: ReleaseDocsIssue[] = [];
  for (const file of input.fixedFiles ?? FIXED_RELEASE_FILES) {
    if (present.has(file) || input.contents[file] !== undefined) continue;
    issues.push({ code: "RELEASE_DOCS_MISSING_FILE", subject: file, message: "固定的发布文档缺失" });
  }
  for (const template of families) {
    const name = template.replace("{v}", input.version);
    if (present.has(name) || input.contents[`${DOC_DIR}${name}`] !== undefined) continue;
    issues.push({
      code: "RELEASE_DOCS_MISSING_FILE",
      subject: `${DOC_DIR}${name}`,
      message: `当前版本 v${input.version} 缺这份发布文档`,
    });
  }
  return issues;
}

/** 三族是否覆盖同一批版本。 */
function familyMismatches(
  input: ReleaseDocsInput,
  families: readonly string[],
  union: Set<string>,
): ReleaseDocsIssue[] {
  const byFamily = versionsByFamily(input.docFiles, families);
  const issues: ReleaseDocsIssue[] = [];
  for (const [template, versions] of byFamily) {
    const missing = [...union].filter((v) => !versions.has(v)).sort();
    if (!missing.length) continue;
    issues.push({
      code: "RELEASE_DOCS_VERSION_FAMILY_MISMATCH",
      subject: template.replace("{v}", "<版本>"),
      message:
        `这一个版本有该族文档、但另两族没有：${missing.join(", ")}——` +
        "三族是同一批版本的发布证据，缺一份就等于那一版的证据不完整",
    });
  }
  return issues;
}

/** 关键词是否齐；`{v}` 在关键词里也要替换（见函数体注释）。 */
function missingNeedles(input: ReleaseDocsInput): ReleaseDocsIssue[] {
  const issues: ReleaseDocsIssue[] = [];
  for (const [template, needles] of Object.entries(input.needles ?? RELEASE_NEEDLES)) {
    const docPath = template.replace("{v}", input.version);
    const text = input.contents[docPath];
    if (text === undefined) continue; // 文件缺失已单独报错，不重复
    // **关键词里的 {v} 也要替换**：`RELEASE_NEEDLES` 写成 `[{v}]` / `runbook-v{v}` 这种形状，
    // 是为了让「换版本时只改一处」。只替换路径不替换关键词，就会拿字面量 `[{v}]` 去比对文档——
    // 那永远匹配不上，于是 CHANGELOG 与 checklist 两条**永久报错**。
    // （这条是单测抓到的：手写 fixture 时才发现「六版本齐全」竟然报 4 条。）
    for (const rawNeedle of needles) {
      const needle = rawNeedle.replace("{v}", input.version);
      if (text.includes(needle)) continue;
      issues.push({
        code: "RELEASE_DOCS_MISSING_NEEDLE",
        subject: docPath,
        message: `缺少必需内容：${needle}`,
      });
    }
  }
  return issues;
}

export function auditReleaseDocs(input: ReleaseDocsInput): ReleaseDocsReport {
  const families = input.families ?? DOC_FAMILIES;
  const union = new Set<string>();
  for (const template of families) {
    for (const file of input.docFiles) {
      const version = versionOfDocName(file, [template]);
      if (version !== null) union.add(version);
    }
  }
  const errors: ReleaseDocsIssue[] = [
    ...missingRequiredFiles(input, families),
    ...familyMismatches(input, families, union),
    ...missingNeedles(input),
  ];
  return {
    errors,
    stats: {
      version: input.version,
      coveredVersions: union.size,
      docFiles: input.docFiles.filter((f) => versionOfDocName(f, families) !== null).length,
    },
  };
}

/** 把问题列表格式化成多行文本（供 CLI 与单测断言）。 */
export function formatReleaseDocsIssues(issues: readonly ReleaseDocsIssue[]): string {
  return issues
    .map((issue) => `❌ [${issue.code}] ${issue.subject}：${issue.message}`)
    .join("\n");
}

/** 成功时的自述行——把覆盖范围一起报出来。 */
export function formatReleaseDocsSummary(report: ReleaseDocsReport): string {
  const { version, coveredVersions, docFiles } = report.stats;
  return (
    `✅ release documentation checks passed (v${version}, ` +
    `${coveredVersions} 个版本的三族发布证据齐全，共 ${docFiles} 份分版本文档)`
  );
}
