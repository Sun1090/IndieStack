/**
 * 文档内部链接可达性审计。
 *
 * 背景：本仓库是**给别人用的模板**，而文档是它的产品。2026-10-01 量到：`docs/` + `docs-site/`
 * + 两份 README + `AGENTS.md` 一共 **132 个 markdown 文件、150 条内部链接**，
 * 而**没有任何门禁检查它们指向的文件是否存在**——也就是 150 个「这里有一份文档」的断言无人核对。
 * 同一类缺陷在 `AGENTS.md` 上已经真实发生过一次（#191：索引表少一行而门禁只要求「至少被引用一次」）。
 *
 * 本模块只判「链接指向的文件是否存在」，**刻意不判锚点是否存在**：
 * 锚点要复刻 VitePress 的标题 slug 生成规则（大小写、标点、emoji、重复标题后缀），
 * 那是一条会随生成器版本漂移的规则——**一条会漂移的规则不如不写**。
 * 锚点坏了表现为「点了没跳」，而文件没了表现为「点了 404」，后者严重得多。
 *
 * **两个真实的假红陷阱，都由本模块处理掉**（它们是手工量的时候自己踩的）：
 *   1. **markdown 链接省略扩展名**：`./storage` 指向的是 `storage.md`。
 *      只试「原样拼接」会把**每一条**文档链接都报成断链——我第一次手工量就是这么得到
 *      「28 条断链」的，而那 28 条的目标文件**全部存在**。
 *   2. **`/x` 是站点根 URL，不是文件系统根**：VitePress 里 `/quickstart` 是合法写法，
 *      映射到 `docs-site/quickstart.md`。按 `path.resolve('/quickstart')` 去查文件系统会全灭。
 *
 * **失败封闭**：一个 markdown 文件都没扫到时报红——「什么都没在看」和「全都可达」长得一模一样。
 */

export type DocLinkCode = "DOC_LINK_BROKEN" | "DOC_LINKS_NOTHING_SCANNED";

export interface DocLinkIssue {
  code: DocLinkCode;
  /** 出现这条链接的文件。 */
  file: string;
  /** 链接目标（原文）。 */
  target: string;
  line: number;
  message: string;
}

export interface DocLinkInput {
  /** 待审计的 markdown 文件（仓库相对路径）。 */
  files: readonly string[];
  /** 每个文件的���文；键为 `files` 里的路径。 */
  contents: Readonly<Record<string, string>>;
  /** 判断某个仓库相对路径是否存在（注入以便单测）。 */
  exists: (repoPath: string) => boolean;
  /** 站点根 URL（`/x`）映射到的目录，默认 `docs-site`。 */
  siteRoot?: string;
  /** 链接正文的匹配结果，供单测复用；默认导出 `extractLinks`。 */
  extract?: (content: string) => Array<{ target: string; line: number }>;
}

export interface ExtractedLink {
  target: string;
  line: number;
}

/** 抽取 markdown 链接，跳过外部链接与纯锚点。行号 1 起算。 */
export function extractLinks(content: string): ExtractedLink[] {
  const out: ExtractedLink[] = [];
  content.split("\n").forEach((line, i) => {
    for (const match of line.matchAll(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[2];
      if (/^(?:https?:|mailto:|tel:)/.test(target)) continue;
      if (target.startsWith("#")) continue;
      out.push({ target, line: i + 1 });
    }
  });
  return out;
}

/** 目录拼接，统一成正斜杠。 */
function join(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join("/")
    .replace(/\/{2,}/g, "/");
}

/** 相对 `fromFile` 解析一个仓库相对路径（不碰文件系统，可单测）。 */
export function resolveRepoPath(fromFile: string, target: string, siteRoot = "docs-site"): string {
  const clean = target.split("#")[0].split("?")[0];
  if (clean.startsWith("/")) return join(siteRoot, clean);
  const base = clean.startsWith("./") || clean.startsWith("../")
    ? pathPosixNormalize(join(dirOf(fromFile), clean))
    : join(dirOf(fromFile), clean);
  return base;
}

function dirOf(file: string): string {
  const at = file.lastIndexOf("/");
  return at === -1 ? "" : file.slice(0, at);
}

/** 只处理 `.` 与 `..` 的最小归一化。 */
function pathPosixNormalize(p: string): string {
  const out: string[] = [];
  for (const part of p.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/**
 * 一条链接指向的文件是否可能存在。
 *
 * 候选顺序刻意把 `原样` 放第一位：如果有人真的写了一个**带扩展名或带目录 index** 的路径，
 * 那是精确指向，不该被「补 .md」的候选蒙混过关。
 */
export function linkCandidates(repoPath: string): string[] {
  // 已经带 `.md` 结尾的路径**只有一个候选就是它自己**：
  // 再补 `.md` 会造出 `README.md.md`，再补 `index.md` 会造出 `README.md/index.md`
  // ——两者都**永远不可能存在**，只会在报错信息里多两个噪音词，掩盖真正试过的候选。
  // （这两条都是单测抓到的：第一版只挡了 `.md`，漏了 `index.md`。）
  if (repoPath.endsWith(".md")) return [repoPath];
  return [repoPath, `${repoPath}.md`, join(repoPath, "index.md")].filter(
    (c) => c && !c.endsWith("/"),
  );
}

export interface DocLinkReport {
  errors: DocLinkIssue[];
  stats: {
    files: number;
    internalLinks: number;
    broken: number;
  };
}

export function auditDocLinks(input: DocLinkInput): DocLinkReport {
  const extract = input.extract ?? extractLinks;
  const errors: DocLinkIssue[] = [];
  let internalLinks = 0;

  for (const file of input.files) {
    const content = input.contents[file];
    if (content === undefined) continue;
    for (const link of extract(content)) {
      internalLinks += 1;
      const repoPath = resolveRepoPath(file, link.target, input.siteRoot);
      const candidates = linkCandidates(repoPath);
      if (candidates.some((candidate) => input.exists(candidate))) continue;
      errors.push({
        code: "DOC_LINK_BROKEN",
        file,
        target: link.target,
        line: link.line,
        message:
          `指向 ${candidates.join(" 或 ")}——都不存在。` +
          "markdown 链接省略 .md 是正常的，所以这几种候选都试过了",
      });
    }
  }

  if (input.files.length === 0) {
    errors.push({
      code: "DOC_LINKS_NOTHING_SCANNED",
      file: "(none)",
      target: "",
      line: 0,
      message: "一个 markdown 文件都没扫到：这道断言量不到任何东西",
    });
  }

  return {
    errors,
    stats: { files: input.files.length, internalLinks, broken: errors.length },
  };
}

/** 把问题列表格式化成多行文本（供 CLI 与单测断言）。 */
export function formatDocLinkIssues(issues: readonly DocLinkIssue[]): string {
  return issues
    .map((issue) => `❌ [${issue.code}] ${issue.file}:${issue.line} → ${issue.target}：${issue.message}`)
    .join("\n");
}

/** 成功时的自述行——把分母一起报出来。 */
export function formatDocLinkSummary(report: DocLinkReport): string {
  const { files, internalLinks } = report.stats;
  return `✅ 文档内部链接全部可达：${internalLinks} 条内部链接 / ${files} 个 markdown 文件`;
}