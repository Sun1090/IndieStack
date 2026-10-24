/**
 * 找出演练 SQL 里的 **psql 元命令**——它们不是 SQL，HTTP 通道送不出去。
 *
 * **为什么要写成代码而不是一句话写在文档里**：B04 的缺口 (a) 原先被写成
 * 「`account-erasure.sql` 里有 5 条 psql 元命令」。那个数是**手量**的，
 * 而且量法错了：探测器只看「行首是反斜杠」，于是漏掉了
 * `select … from d \gset drill_` 这种**行尾**元命令。
 * 真实条数是 **6**（`grep -o ":'drill_" … | wc -l` 复核：16 处引用），
 * 而漏掉的偏偏是唯一那条**结构性**的——
 * `\gset` 把 temp 表里的值取进 psql 变量，供后面 **16 处** `:'drill_*'` 引用。
 * 漏掉它会让转换工作从一开始就少一整层，而看起来只是「一个数写错了」。
 *
 * 所以这里把量法固化：条数由代码算，文档只引用它的结论。
 *
 * ## 三类元命令的代价完全不同（这才是这个模块要区分它们的原因）
 *
 * | 类别 | 例子 | 转换时怎么处理 |
 * | ---- | ---- | -------------- |
 * | `cosmetic` | `\echo '--- 标题 ---'` | **直接删**。它只是给人看的分隔标签。 |
 * | `error-handling` | `\set ON_ERROR_STOP on` | **删掉并说明**：HTTP 通道没有这个开关，出错靠响应码判断。 |
 * | `structural` | `\gset` + `:'var'` | **必须翻译成 SQL**。删了它，依赖它的语句全部失去输入。 |
 *
 * **刻意不把 `\set` 一律算成 cosmetic**：`\set x 5` 和 `\gset` 一样是在造变量。
 * 分类只看「它有没有产出后续要用的东西」，不看名字。
 */

/** 一条元命令的产物：出现在第几行、是什么命令、属于哪一类。 */
export interface PsqlMetaCommand {
  /** 1 起的行号。 */
  line: number;
  /** 命令名，不含反斜杠，如 `set` / `echo` / `gset`。 */
  command: string;
  category: "cosmetic" | "error-handling" | "structural";
  /** 去掉首尾空白的整行原文，便于报告里点名。 */
  text: string;
}

/**
 * 已知的 psql 元命令名。
 *
 * 只列**本仓库可能用到**的那些，不做 psql 全量清单：
 * 认不全的命令必须由 `unknownBackslash` 报出来（失败封闭），
 * 而不是静默当成 SQL——那正是「5 条」这个错能发生的形状。
 */
const KNOWN_COMMANDS = new Set([
  "set",
  "echo",
  "gset",
  "if",
  "endif",
  "else",
  "elif",
  "connect",
  "password",
  "quit",
  "i",
  "include",
  "ir",
  "unset",
  "prompt",
]);

/**
 * 元命令名：反斜杠后面紧跟的字母串。
 *
 * **不能只探测行首**——`\gset` 就挂在 `select … from d \gset drill_` 的**末尾**，
 * 而「只看行首」正是「5 条」这个错的直接成因。
 */
const META_NAME = /\\([a-z]+)\b/gi;

function classify(command: string, text: string): PsqlMetaCommand["category"] {
  const name = command.toLowerCase();
  if (name === "echo" || name === "prompt") return "cosmetic";
  // `\set ON_ERROR_STOP on` 是**错误处理开关**；而 `\set x 5` 和 `\gset` 一样在造变量，
  // 属于 structural。只看命令名会把两者混为一谈——那正是「按名字分类」的失败方式。
  if (name === "set" && /\bset\s+on_error_stop\b/i.test(text)) return "error-handling";
  if (name === "set" || name === "unset") return "structural";
  // \gset / \if / \connect / \i 都会改变后续语句的输入或走向
  return "structural";
}

/**
 * 剥掉行注释，但**保留字符串字面量**（`select '\echo x'` 里的不是元命令）。
 *
 * 导出它是因为 `erasure-drill-parity.test.ts` 也要问同一个问题——
 * 「这行反斜杠 / 这句 `set role` 是在**代码**里还是在**说明文字**里」。
 * 两处各写一份就会各错一份：派生版那条用例的第一版没剥注释，
 * 于是把文件头解释里的 `set role service_role` 也数了进去（2 数成 3）。
 */
export function stripLineComment(line: string): string {
  let inString = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "'") inString = !inString;
    else if (!inString && char === "-" && line[index + 1] === "-") return line.slice(0, index);
  }
  return line;
}

/** 整段 SQL 去掉行注释后的**代码部分**（派生版核对要用它区分「代码 vs 说明文字」）。 */
export function stripSqlLineComments(sql: string): string {
  return sql.split("\n").map(stripLineComment).join("\n");
}

/** 认不全的反斜杠用法——必须报出来，不能静默放过。 */
export function unknownBackslashes(sql: string): { line: number; text: string }[] {
  const found: { line: number; text: string }[] = [];
  sql.split("\n").forEach((rawLine, index) => {
    const line = stripLineComment(rawLine);
    // 跳过 SQL 字符串里的反斜杠（如 `E'\n'`）：本仓库的演练不用它，但别误报
    const withoutStrings = line.replace(/'(?:[^']|'')*'/g, "''");
    for (const match of withoutStrings.matchAll(/\\+([a-z]*)/gi)) {
      const name = (match[1] ?? "").toLowerCase();
      if (name.length > 0 && !KNOWN_COMMANDS.has(name)) {
        found.push({ line: index + 1, text: rawLine.trim() });
      }
    }
  });
  return found;
}

/** 找出全部 psql 元命令，按行号排序。 */
export function findPsqlMetaCommands(sql: string): PsqlMetaCommand[] {
  const commands: PsqlMetaCommand[] = [];
  sql.split("\n").forEach((rawLine, index) => {
    const line = stripLineComment(rawLine);
    if (line.trim().length === 0) return;

    // 字符串字面量里的反斜杠不是元命令（`select '\echo x'` 只是文本）
    const code = line.replace(/'(?:[^']|'')*'/g, "''");
    const names = new RegExp(META_NAME.source, "gi");
    const seen = new Set<string>();
    for (const match of code.matchAll(names)) {
      const name = (match[1] ?? "").toLowerCase();
      if (name.length > 0 && KNOWN_COMMANDS.has(name)) seen.add(name);
    }

    for (const name of seen) {
      commands.push({
        line: index + 1,
        command: name,
        category: classify(name, rawLine),
        text: rawLine.trim(),
      });
    }
  });
  return commands;
}

/** 一句话结论：可直接贴进文档，避免再有人手量。 */
export function describePsqlMetaCommands(commands: PsqlMetaCommand[]): string {
  const by = (category: PsqlMetaCommand["category"]) =>
    commands.filter((command) => command.category === category).length;
  return (
    `${commands.length} 条（cosmetic ${by("cosmetic")} / error-handling ${by("error-handling")} / ` +
    `structural ${by("structural")}）`
  );
}
