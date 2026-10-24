/**
 * plpgsql `RAISE` 的占位符核对。
 *
 * **为什么需要它**（2026-10-13 在本地栈实测，每条读数都可重跑）：
 * RAISE 的格式串里**每一个裸 `%` 都是一个占位符**，包括那些本意是字面文本的。
 *
 * | 写法 | 实测输出 |
 * |---|---|
 * | `raise 'A=20% B', 'X'` | `A=20X B`（参数被贴进 "20" 后面） |
 * | `raise 'failures=% assertions=20% report=%', n, i, r` | `failures=0 assertions=20 [obj] report=ALL` |
 * | `raise 'failures=% assertions=20% report=%', n, r` | `too few parameters specified for RAISE` |
 * | `raise 'A=20%% B'` | `A=20% B`（`%%` 是转义，不占参数） |
 * | `raise '%' , '100%'` | `100%`（参数值**不会**被二次扫描） |
 *
 * 第一、二行是**静默的**：请求成功、消息看起来合理，只有参数**数量不够**时才会响。
 * 而演练报告恰恰爱写百分比（`assertions=20%`），是最容易撞上的形状。
 * 所以这里把「数一数」固化下来，让 `raise-format.test.ts` 扫所有派生版演练 SQL。
 *
 * ⚠️ 顺带否证一条本仓库写过的解释：`% ` 被当成「带 flag 的转换、会吃掉空格」
 * 是**错的**——那是 `format()` 的行为（`format('a=% 5s', x)` 回
 * `unrecognized format() type specifier " "`），RAISE 不是 `format()`。
 * 真机制就是上表：裸 `%` 一律算占位符。
 */

/** 一条 RAISE 语句的占位符核对结果。 */
export interface RaiseStatement {
  /** 语句原文（用于报告时点名）。 */
  text: string;
  /** 裸 `%` 的个数（`%%` 是转义，不计）。 */
  placeholders: number;
  /** 逗号后面的参数个数。 */
  args: number;
  /** 是否存在「数字紧跟裸 %」——百分比字面量被当成占位符的信号。 */
  digitPercent: boolean;
}

/** 认 plpgsql 的 raise 关键字（含 `raise notice` 等，虽然本仓库只用 exception）。 */
const RAISE = /raise\s+(?:exception|warning|notice|info|log|debug(?:_[a-z0-9]+)?)\s+((?:'(?:[^']|'')*'|[^;])+)/gi;

/** plpgsql 的 `RAISE <level> USING …` 形态没有位置参数，撞不上这个陷阱。 */
const USING_FORM = /\busing\s+(?:message|errcode|column|constraint|datatype|table|schema)\b/i;

/**
 * 按**顶层**逗号切参数列表。
 *
 * 必须管引号与括号深度：`raise 'a=%', coalesce(v, 'x, y')` 只有一个参数，
 * 直接 `split(",")` 会数出 3 个（`'x, y'` 里那两个逗号）。
 * 数错方向的代价不对称——**多算参数**会让「占位符 = 参数」这条判据
 * 在真实安全写法上报错，于是所有人开始忽略这个检查。
 */
export function splitTopLevelArgs(list: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let inString = false;
  let current = "";
  for (let index = 0; index < list.length; index += 1) {
    const char = list[index];
    if (inString) {
      current += char;
      if (char === "'") {
        // SQL 里 '' 是转义的单引号，不结束字符串
        if (list[index + 1] === "'") {
          current += "'";
          index += 1;
        } else inString = false;
      }
      continue;
    }
    if (char === "'") inString = true;
    else if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    if (char === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

/** 数裸 `%`：`%%` 一次跳过两个字符，其余每个 `%` 算一个占位符。 */
export function countBarePercent(format: string): number {
  let count = 0;
  for (let index = 0; index < format.length; index += 1) {
    if (format[index] !== "%") continue;
    if (format[index + 1] === "%") index += 1;
    else count += 1;
  }
  return count;
}

/**
 * 解析一条 RAISE 的 `格式串 + 参数`。
 *
 * 只处理「格式串是第一个字面量」这一种形态——`raise ... using` 语法不在此列，
 * 因为它没有位置参数，撞不上这个陷阱。
 */
export function parseRaiseStatement(statement: string): RaiseStatement {
  // 允许传**整条** `raise exception '…', …`，也允许传 RAISE 正则抓到的那一段：
  // 调用方不必记住这里吃的是哪种形状（记错的代价是「数出 0 个占位符」这种假绿）。
  const withoutKeyword = statement
    .trim()
    .replace(/^raise\s+(?:exception|warning|notice|info|log|debug(?:_[a-z0-9]+)?)\s+/i, "")
    // 调用方常连着分号一起传（`raise exception '…';`），留着它会让下面的锚点失配，
    // 而失配的表现是「数出 0 个占位符」——**看起来是绿的**。
    .replace(/;\s*$/, "");
  if (USING_FORM.test(withoutKeyword)) {
    return { text: statement.trim(), placeholders: 0, args: 0, digitPercent: false };
  }
  const match = /^\s*((?:'(?:[^']|'')*'|\$[a-z_]*\$[\s\S]*?\$[a-z_]*\$)(?:\s*,\s*[\s\S]*)?)$/.exec(
    withoutKeyword,
  );
  if (!match) {
    return { text: statement.trim(), placeholders: 0, args: 0, digitPercent: false };
  }
  const body = match[1];
  const format = /^\s*'((?:[^']|'')*)'/.exec(body)?.[1] ?? "";
  const rest = body.replace(/^\s*'(?:[^']|'')*'\s*,?/, "").trim();
  const args = rest ? splitTopLevelArgs(rest).length : 0;
  return {
    text: statement.trim(),
    placeholders: countBarePercent(format),
    args,
    // `20%` 这种字面百分比：作者以为它是文本，PostgreSQL 以为它是占位符
    digitPercent: /\d%(?!%)/.test(format),
  };
}

/** 扫出一份 SQL 里所有 RAISE 语句。 */
export function findRaiseStatements(sql: string): RaiseStatement[] {
  return [...sql.matchAll(RAISE)].map((match) => parseRaiseStatement(match[1]));
}

/**
 * 判定：有没有「会静默错位」的 RAISE。
 *
 * 两条判据，各自对应一种真实失败：
 *   1. `placeholders !== args` ⇒ 数量对不上。**其中「参数不够」PostgreSQL 自己会报**，
 *      但「参数多了」也一样报（`too many parameters`），所以这条主要是把读数说清楚；
 *   2. `digitPercent` ⇒ 格式串里有百分比字面量。**这一条数据库完全不报**，
 *      输出看起来合理却已经错位——真正需要人看的是这条。
 */
export function auditRaiseFormats(
  statements: RaiseStatement[],
  label: string,
): { label: string; text: string; problem: string }[] {
  const findings: { label: string; text: string; problem: string }[] = [];
  for (const statement of statements) {
    const head = statement.text.slice(0, 80);
    if (statement.placeholders !== statement.args) {
      findings.push({
        label,
        text: head,
        problem: `占位符 ${statement.placeholders} 个、参数 ${statement.args} 个——对不上`,
      });
    }
    if (statement.digitPercent) {
      findings.push({
        label,
        text: head,
        problem:
          "格式串里有「数字紧跟裸 %」（百分比字面量）——RAISE 会把它当占位符，静默错位",
      });
    }
  }
  return findings;
}
