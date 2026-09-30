/**
 * CHANGELOG 的已发布版本与 git tag 的对账。
 *
 * 背景：这是本仓库**面向使用者**的那份文件，而它当前的状态是「读者看不到的谎」——
 * `CHANGELOG.md` 写着 `0.7.0`（2026-09-12）到 `0.11.0`（2026-09-22）五个已发布章节、
 * 合计约 170 条内容，而 `git tag` 与 GitHub Release **只有 `v0.6.0`**。
 *
 * 需要说清楚的是：**这不是谁写错了**。生产确实部署过 `0.11.0`（roadmap 开头有记录），
 * tag 是**刻意不打**的——缺账户删除端到端演练与 commit 归属证据（B01/B02/B03，全部卡外部权限）。
 * 那个判断是对的，不该由本模块推翻。
 *
 * 问题出在**它只被记在 `docs/progress.md` 里**，而 `CHANGELOG.md` 那一侧完全没提。
 * 于是：任何人读 CHANGELOG 都会以为存在 5 个可 `git checkout v0.11.0` 的发布；
 * 任何审计 tag 的人都会发现只有 6 个版本对得上。**两边都「正常」，而它们互相矛盾。**
 *
 * 而 `check:release-tag` 并不管这件事——它校验的是**发布工作流的契约**
 * （tag 命名、notes 必须来自 CHANGELOG 章节、禁止 `--generate-notes`），
 * 读的是配置与文档，**不读 `git tag`**。于是一个真实的发布事实分叉没有任何门禁会发现。
 *
 * 本模块把这件事变成可判定的规则，且刻意**不要求那 5 个版本立刻有 tag**——
 * 那是 B01/B02/B03 的事，属外部权限。规则只要求：**每一个分叉都必须被显式登记**。
 *
 *   - CHANGELOG 的每个已发布版本，要么有对应 tag，要么在 `MISSING_TAG_LEDGER` 里登记理由；
 *   - **反过来**也判：某个 tag 若在 CHANGELOG 里找不到对应章节 → 报错
 *     （打了 tag 却没写章节，与前面是同一种分叉，方向相反）；
 *   - **登记过期也要红**：某个版本已经有 tag 了，登记就该删——过期的登记会让一件已经做完的
 *     事继续看起来没做完（同 `gate-wiring.ts` 对豁免表做过期的处理）；
 *   - **一条版本都没解析出来时报红**（解析失效应出声）。
 *
 * 分母与分子都自报：已发布版本数、有 tag 的、登记豁免的。
 */

export type ChangelogTagCode =
  | "NO_VERSIONS_PARSED"
  | "VERSION_WITHOUT_TAG"
  | "TAG_WITHOUT_VERSION"
  | "STALE_LEDGER_ENTRY"
  | "DISCLOSURE_MISSING";

export interface ChangelogTagIssue {
  code: ChangelogTagCode;
  subject: string;
  message: string;
}

/** 一个已发布版本。 */
export interface ReleasedVersion {
  /** 不带 `v` 的版本号，如 `0.11.0`。 */
  version: string;
  /** 章节标题里的日期（ISO）。 */
  date: string;
  /** 该章节的条目数。 */
  entries: number;
}

export interface ChangelogTagInput {
  /** 从 CHANGELOG 解析出的已发布版本（不含 `Unreleased`）。 */
  versions: readonly ReleasedVersion[];
  /** CHANGELOG 标题与第一个版本标题之间的说明文字（用于判披露在不在）。 */
  intro: string;
  /** 仓库里实际存在的 tag，形如 `v0.6.0`。 */
  tags: readonly string[];
  /** 已知缺口台账：版本 → 缺 tag 的理由。 */
  ledger: Readonly<Record<string, string>>;
  /** tag 前缀。 */
  tagPrefix?: string;
}

export interface ChangelogTagReport {
  errors: ChangelogTagIssue[];
  stats: {
    versions: number;
    tagged: number;
    /** 台账里登记但已经有 tag 的（正常情况下为 0）。 */
    staleLedger: number;
    ledgerSize: number;
  };
}

const RULE_MESSAGES: Record<ChangelogTagCode, string> = {
  NO_VERSIONS_PARSED:
    "CHANGELOG 里一条已发布版本都没解析出来：对账量不到任何东西，先确认文件结构",
  VERSION_WITHOUT_TAG:
    "CHANGELOG 声明了这个已发布版本，但仓库里没有对应 tag——要么补 tag，要么在 MISSING_TAG_LEDGER 里登记理由",
  TAG_WITHOUT_VERSION: "仓库里有这个 tag，但 CHANGELOG 没有对应章节：tag 与变更日志互相矛盾",
  STALE_LEDGER_ENTRY: "这个版本已经有 tag 了，MISSING_TAG_LEDGER 里的登记已过期，请删掉它",
  DISCLOSURE_MISSING:
    "CHANGELOG 开头的说明没有指向发布标签台账：读者会以为每个版本号都能 checkout 出来",
};

/**
 * CHANGELOG 开头必须出现的台账指针。
 *
 * **为什么这条也要判**：上面五条规则保证「每个分叉都被显式登记」，但**登记在代码里、读者看不见**。
 * 于是最省事的一次「整理」就是把 CHANGELOG 开头那段说明删掉——文件立刻变得干净好看，
 * 而分叉原封不动。**一个只存在于代码里的真相，仍然是读者读不到的真相。**
 * 所以这里判的是**披露本身在不在**，而不是披露写得详不详细。
 */
export const DISCLOSURE_POINTER = "docs/operations/release-tag-ledger.md";

/**
 * 已知缺口台账：CHANGELOG 声明了、但**刻意还没打 tag** 的版本，必须逐个写明理由。
 *
 * 这不是「欠账清单」，是「**这里有一笔真实的分叉，而它是有意为之**」的登记表。
 * 写下理由的代价是：将来证据闭合、tag 补上之后，**必须回来删掉对应条目**
 * （否则 `STALE_LEDGER_ENTRY` 会红）——那正是我们希望发生的事：一件做完的事不该继续
 * 看起来没做完。
 *
 * **本模块不推翻「证据没闭合就不打 tag」这个判断**，只是让它在 CHANGELOG 那一侧也**看得见**。
 * 11 个已发布版本里只有 `v0.6.0` 有 tag，**10 个没有**——而两组的理由**不同**，所以逐条写：
 *
 * - **0.1.0–0.5.0：标签纪律还不存在。** J07（tag / Release Notes 自动化门禁）是在 **v0.6.0
 *   那个周期**落地的（`docs/roadmap-0.6.0.md` 的 J07 条目），而 `v0.6.0` 恰好就是唯一一个
 *   有 tag 的版本——两件事对得上，不是巧合。给这 5 个版本**补打 tag 等于伪造从未发生过的
 *   发布证据**，所以不补。
 * - **0.7.0–0.11.0：纪律已在，证据未闭合。** 生产确实部署过（`docs/roadmap-0.12.0.md`
 *   开头记录了 0.11.0 的生产部署），而 tag 的前置——账户删除端到端演练、commit 归属证据、
 *   带 commit 的生产构建——全部需要**外部权限**（Vercel 部署与 build 配额、云端 Supabase
 *   管理凭据、可牺牲的隔离账号），见 B01/B02/B03。这是**有意的克制**，不是遗漏。
 */
export const MISSING_TAG_LEDGER: Readonly<Record<string, string>> = {
  "0.1.0": "标签纪律（J07）在 v0.6.0 周期才落地，此版本发布时尚不存在；补打 tag 等于伪造发布证据",
  "0.2.0": "标签纪律（J07）在 v0.6.0 周期才落地，此版本发布时尚不存在；补打 tag 等于伪造发布证据",
  "0.3.0": "标签纪律（J07）在 v0.6.0 周期才落地，此版本发布时尚不存在；补打 tag 等于伪造发布证据",
  "0.4.0": "标签纪律（J07）在 v0.6.0 周期才落地，此版本发布时尚不存在；补打 tag 等于伪造发布证据",
  "0.5.0": "标签纪律（J07）在 v0.6.0 周期才落地，此版本发布时尚不存在；补打 tag 等于伪造发布证据",
  "0.7.0": "生产已部署；tag 前置的账户删除端到端演练与 commit 归属证据未闭合（B01/B02/B03，需外部权限）",
  "0.8.0": "生产已部署；同上，发布证据未闭合（B01/B02/B03，需外部权限）",
  "0.9.0": "生产已部署；同上，发布证据未闭合（B01/B02/B03，需外部权限）",
  "0.10.0": "生产已部署；同上，发布证据未闭合（B01/B02/B03，需外部权限）",
  "0.11.0":
    "生产已部署（docs/roadmap-0.12.0.md 开头有记录）；缺账户删除演练与 commit 归属证据，tag 刻意不打（B01/B02/B03，需外部权限）",
};

/** 从 tag 列表里取出 `v<version>` 形式的版本号（无 `v` 前缀）。 */
export function versionsFromTags(tags: readonly string[], tagPrefix = "v"): Set<string> {
  const out = new Set<string>();
  for (const tag of tags) {
    if (!tag.startsWith(tagPrefix)) continue;
    const version = tag.slice(tagPrefix.length);
    if (/^\d+\.\d+\.\d+$/.test(version)) out.add(version);
  }
  return out;
}

/** 对账：CHANGELOG 的已发布版本与仓库 tag。 */
export function auditChangelogTags(input: ChangelogTagInput): ChangelogTagReport {
  const errors: ChangelogTagIssue[] = [];
  const tagPrefix = input.tagPrefix ?? "v";
  const tagged = versionsFromTags(input.tags, tagPrefix);
  const described = new Set(input.versions.map((entry) => entry.version));

  if (input.versions.length === 0) {
    errors.push({ code: "NO_VERSIONS_PARSED", subject: "CHANGELOG.md", message: RULE_MESSAGES.NO_VERSIONS_PARSED });
  }

  let taggedCount = 0;
  for (const entry of input.versions) {
    if (tagged.has(entry.version)) {
      taggedCount += 1;
      continue;
    }
    const reason = input.ledger[entry.version];
    // 空理由等于没登记：否则 `""` 就能把这条门禁关掉，而台账看起来还是「有登记的」。
    // 与 `gate-wiring.ts` 对豁免表的处理同一条纪律。
    if (reason === undefined || reason.trim() === "") {
      errors.push({
        code: "VERSION_WITHOUT_TAG",
        subject: entry.version,
        message: RULE_MESSAGES.VERSION_WITHOUT_TAG,
      });
    }
  }

  for (const version of tagged) {
    if (described.has(version)) continue;
    errors.push({
      code: "TAG_WITHOUT_VERSION",
      subject: `${tagPrefix}${version}`,
      message: RULE_MESSAGES.TAG_WITHOUT_VERSION,
    });
  }

  // 失败封闭：**没有**说明文字与**说明文字里没有指针**同样判红。不留「传 undefined 就跳过」
  // 这种口子——那等于给「删掉披露」留了一扇后门。
  if (!input.intro || !input.intro.includes(DISCLOSURE_POINTER)) {
    errors.push({
      code: "DISCLOSURE_MISSING",
      subject: "CHANGELOG.md",
      message: RULE_MESSAGES.DISCLOSURE_MISSING,
    });
  }

  let stale = 0;
  for (const version of Object.keys(input.ledger)) {
    if (!tagged.has(version)) continue;
    stale += 1;
    errors.push({
      code: "STALE_LEDGER_ENTRY",
      subject: version,
      message: RULE_MESSAGES.STALE_LEDGER_ENTRY,
    });
  }

  return {
    errors,
    stats: {
      versions: input.versions.length,
      tagged: taggedCount,
      staleLedger: stale,
      ledgerSize: Object.keys(input.ledger).length,
    },
  };
}

/**
 * 成功时的自述行——分母与分子一起报出来。
 *
 * 放在规则模块而不是 CLI 里，是因为**它已经错过一次**：第一版把这行写在
 * `scripts/lib/changelog-tag-check.js` 里，写成了 `versions - tagged`（`versions` 是那个
 * 数组，数组减数字是 `NaN`），于是它自报「NaN 个在台账里登记了」。规则与单测全绿，
 * 门禁 exit 0，**只有这一行是错的**——而它恰恰是唯一会被人读的那一行。
 * 「输出里唯一给人看的那句话」必须有单测。
 */
export function formatChangelogTagSummary(report: ChangelogTagReport): string {
  const { versions, tagged, ledgerSize } = report.stats;
  return (
    `✅ CHANGELOG 与 git tag 一致：${versions} 个已发布版本，${tagged} 个有 tag，` +
    `${versions - tagged} 个在 MISSING_TAG_LEDGER 里登记了「刻意不打 tag」的理由（台账 ${ledgerSize} 条）`
  );
}

/** 把问题列表格式化成多行文本（供 CLI 与单测断言）。 */
export function formatChangelogTagIssues(issues: readonly ChangelogTagIssue[]): string {
  return issues
    .map((issue) => `❌ [${issue.code}] ${issue.subject}：${issue.message}`)
    .join("\n");
}
