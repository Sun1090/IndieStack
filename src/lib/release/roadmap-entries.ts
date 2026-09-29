/**
 * 任务池条目的状态纪律（roadmap 治理）。
 *
 * **这条规则是从两次真实的踩坑里长出来的**，不是设想：
 *
 * 1. C09 写着「那 8 处 `user!.id` 现在不动，原因是 5 条分支正在重写同一批文件」，
 *    而那条 46 项的待合并队列**早在两天前就清空了**。阻塞条件消失了，正文没人回头改，
 *    于是「推迟」静悄悄地变成了「没人再回来」——一条早已可以做的待办在任务池里躺成了一句历史。
 * 2. C06 写着「定夺……保留还是删除」，而定案结论（**删除**）躺在 CHANGELOG 里两天，
 *    roadmap 那一行仍然是开放式问句。任何人回来读它都会重新决策一次。
 *
 * 两次的共同点不是「忘了写文档」，而是**忘了改那一行**——而那一行没有任何东西在管。
 * 所以这条规则只做一件事：**每一条任务池条目要么带就地完成标注，要么写明它被什么挡住。**
 *
 * 判据的形状刻意很窄：只看「条目第一条正文里有没有带日期的完成/定案标注」，
 * 以及「有没有显式写出阻塞原因」。它不判断任务本身做得对不对（那是退出报告的事），
 * 也不去数条数（条数写在这里就会随队列漂移，roadmap 开头为此专门改过一次口径）。
 *
 * **失败封闭的那一半**：一条条目都没解析出来时报红，而不是返回空数组——
 * 「没扫到」和「全都合规」长得一模一样（与 `RATE_LIMIT_NOTHING_MEASURED`、
 * `inspectProductionMockSettings` 的 `no production surface` 同一纪律）。
 */

export type RoadmapEntryIssueCode =
  /** 任务池里一条条目都没解析出来：目录约定或解析器失效，不能报「全部合规」。 */
  | "ROADMAP_NO_ENTRIES"
  /** 条目既没有带日期的完成标注，也没有写明被什么挡住。 */
  | "ROADMAP_ENTRY_UNMARKED"
  /** 标注声称「已完成」但没有日期：日期是这条规则真正的判据。 */
  | "ROADMAP_MARKER_UNDATED"
  /** 完成标注里的日期不是 `YYYY-MM-DD`。 */
  | "ROADMAP_MARKER_MALFORMED";

export interface RoadmapEntryIssue {
  code: RoadmapEntryIssueCode;
  subject: string;
  message: string;
}

/** 任务池条目的编号：领域前缀 + 数字，可带 `-b` / `-c` 这样的后缀。 */
const ENTRY_ID = /^\s*\d+\.\s+([A-D]\d+(?:-[a-z])?)\s/;
/** 「## 任务池」到下一个 `## ` 之间才是任务池；退出标准那节里也有 `1. A01–A04…`，必须排掉。 */
const POOL_HEADING = /^##\s+任务池/m;
const SECTION_BREAK = /^##\s+(?!任务池)/m;
/**
 * 就地完成标注：`（**2026-09-22 已完成**：…）` / `（2026-09-25 定案并落地…）`。
 *
 * **日期是必需的，不是可选的**——第一版把它写成 `(\d{4}-\d{2}-\d{2})?`，
 * 于是 `（**已完成**：…）` 两条规则同时命中，UNDATED 那一支永远走不到：
 * 判据自己废掉了自己，而单测当时是绿的（它只测了「有日期」这一侧）。
 * 现在缺日期归 UNDATED，日期格式坏了则两条都不命中、落到 UNMARKED，
 * 两者都以「必须补一个 `YYYY-MM-DD`」的方式收敛到同一处。
 */
const DATED_MARKER =
  /（\*{0,2}\d{4}-\d{2}-\d{2}\s*(?:已定案并完成|已完成|已定案|已收口|已收完|已落地|已核对|定案并落地|定案并完成|收完)/;
/** 看着像标注却缺日期的写法：`（**已完成**：…）` / `（随 A01 完成：…）`。 */
const UNDATED_MARKER = /（\*{0,2}(?:已完成|已定案|已完成（|随 .{0,8} 完成)/;
/** 显式阻塞：写明这条为什么还不能做。命中任一即算「有交代」。 */
const BLOCKED_MARKERS = [
  /产品决策/,
  /待决/,
  /外部权限/,
  /等外部/,
  /上游缺失/,
  /需要.{0,12}(?:凭据|账号|密钥|配额)/,
  /不可用/,
] as const;

export interface RoadmapEntry {
  id: string;
  /** 条目从标题起的第一段正文（足够判状态，又不会被整条的长文淹没）。 */
  opening: string;
}

function issue(code: RoadmapEntryIssueCode, subject: string, message: string): RoadmapEntryIssue {
  return { code, subject, message };
}

/** 抽出任务池的正文区间：起于 `## 任务池`，止于下一个 `## ` 标题。 */
export function extractTaskPool(markdown: string): string | null {
  const start = POOL_HEADING.exec(markdown);
  if (start === null) return null;
  const rest = markdown.slice(start.index + start[0].length);
  const end = SECTION_BREAK.exec(rest);
  return end === null ? rest : rest.slice(0, end.index);
}

/**
 * 解析任务池条目。只认文件里真实存在的那套写法：数字 + 域前缀 + ID。
 *
 * **每条的开头在下一条开始处截断，不是一个固定的行数或字数窗口。**
 * 第一版取「标题 + 后面 16 行」，量出来的后果是：把某一条的完成标注删掉之后它仍然报绿，
 * 因为窗口越过了下一条的标题，**借用了下一条的完成标注当自己的证据**。
 * 那正是这条规则要抓的那类缺陷（结论做完了、正文没改），所以判据本身不能有这一格。
 * 借用比没有判据更坏——它让门禁在一个条目上永远报绿。
 */
export function parseTaskPoolEntries(markdown: string): RoadmapEntry[] {
  const pool = extractTaskPool(markdown);
  if (pool === null) return [];

  const lines = pool.split("\n");
  const starts: { id: string; index: number }[] = [];
  lines.forEach((line, index) => {
    const id = ENTRY_ID.exec(line);
    if (id !== null) starts.push({ id: id[1], index });
  });

  return starts.map((start, position) => {
    const end = position + 1 < starts.length ? starts[position + 1].index : lines.length;
    // 从标题行起到下一条标题行止；状态标注常写在第二行，所以这段不能只取首行。
    const opening = lines.slice(start.index, end).join(" ");
    return { id: start.id, opening };
  });
}

/**
 * 每一条要么带日期的完成标注，要么写明被什么挡住。
 *
 * `exempt` 是给「这一条根本不是任务」用的显式出口（例如将来把里程碑小节误收进任务池）。
 * 开这个口子的理由和 C13 那条判据一样：**不**开「谁都可以把自己排除在外」的通用白名单，
 * 但要留一个**必须写理由**的位置——一个空的 `exempt` 不会让任何条目过关。
 */
export function inspectRoadmapEntries(
  markdown: string,
  exempt: Readonly<Record<string, string>> = {},
): RoadmapEntryIssue[] {
  const entries = parseTaskPoolEntries(markdown);
  if (entries.length === 0) {
    return [
      issue(
        "ROADMAP_NO_ENTRIES",
        "docs/roadmap-0.12.0.md",
        "任务池里一条条目都没解析出来：标题约定或解析器失效，不能报「全部合规」",
      ),
    ];
  }

  const issues: RoadmapEntryIssue[] = [];
  for (const entry of entries) {
    if (Object.prototype.hasOwnProperty.call(exempt, entry.id)) {
      const reason = exempt[entry.id].trim();
      if (reason === "") {
        issues.push(
          issue("ROADMAP_ENTRY_UNMARKED", entry.id, "豁免必须写明理由，空理由等于没有豁免"),
        );
      }
      continue;
    }

    if (UNDATED_MARKER.test(entry.opening) && !DATED_MARKER.test(entry.opening)) {
      issues.push(
        issue(
          "ROADMAP_MARKER_UNDATED",
          entry.id,
          "完成标注没有日期：日期是这条规则真正的判据，理由与结论一起写才可复核",
        ),
      );
      continue;
    }

    if (DATED_MARKER.test(entry.opening)) continue;
    if (BLOCKED_MARKERS.some((pattern) => pattern.test(entry.opening))) continue;

    issues.push(
      issue(
        "ROADMAP_ENTRY_UNMARKED",
        entry.id,
        "既没有带日期的完成标注，也没有写明被什么挡住（产品决策 / 外部权限 / 上游缺失）",
      ),
    );
  }
  return issues;
}

export function formatRoadmapIssues(issues: readonly RoadmapEntryIssue[]): string {
  return issues.map((item) => `  - [${item.code}] ${item.subject}: ${item.message}`).join("\n");
}
