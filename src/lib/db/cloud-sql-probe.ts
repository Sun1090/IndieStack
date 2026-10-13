/**
 * 「云端那个库能不能**执行 SQL**」——以及「送出去的这条语句会不会写数据」。
 *
 * 起因是 B04（`docs/operations/drills/*.sql` 的云端同型演练）的阻塞理由被写错过三次。
 * 2026-10-13 打开 Supabase Management API 文档原文核实
 * （`https://supabase.com/docs/reference/api/v1-run-a-query`、`…/v1-read-only-query`、
 * `…/v1-apply-a-migration`），读到两件此前没登记过的事：
 *
 *   1. `POST /v1/projects/{ref}/database/query` 的鉴权口径写的是
 *      **`database_read` 或 `database_write`**——一个只有**只读**权限的令牌
 *      就能打这个「能写」的端点；
 *   2. 另有 `POST /v1/projects/{ref}/database/query/read-only`，文档原文
 *      「Run a sql query **as supabase_read_only_user**」，鉴权只要 `database_read`，
 *      并要求「All entity references must be schema qualified」。
 *
 * 合起来的含义：**「在云端执行 SQL」这件事不需要数据库密码**，需要的是仓库里
 * 早就有的 `SUPABASE_ACCESS_TOKEN`。（`ops:migration-status` 用的
 * `GET /database/migrations` 只是「读迁移版本列表」，那是另一个能力。）
 *
 * 但「能执行 SQL」同时意味着**这个探测有能力改生产数据**。所以本模块的主体不是网络调用，
 * 而是那条**失败封闭的只读守卫**：计划里每条语句都必须先过 `assertProbeSqlReadOnly`，
 * 任何一条被判为可写就整体拒绝发请求。这样「探测不会写库」是**代码性质**，
 * 不是某个人的一次口头承诺。
 *
 * 守卫口径（刻意保守：宁可拒真，不可放假）：
 *   - 顶层语句首关键字必须 ∈ `ALLOWED_FIRST_KEYWORDS`；
 *   - `do` 走单独一条路：允许，但**块体**再过一遍写入关键字黑名单
 *     （含 `perform`——它能调用写函数；含 `into`——`select … into` 会建表）；
 *   - 引号 / dollar-quote / 注释的内容在扫描前被**抹成空格**，所以
 *     `select 'insert into t; --'` 不会被误判成可写；
 *   - 未闭合的引号、dollar-quote、块注释一律判不可读 ⇒ 拒绝。
 *     第一版在这里踩过两个坑：未闭合 dollar-quote 直接抛 `TypeError`（崩溃不是拒绝），
 *     以及把 dollar-quote 的开标签连同索引一起跳过导致 `dollarTags` 永远取不到块体。
 *
 * **它不放行 B04 的演练 SQL**：那份正本要 `insert` / `delete` / `perform cleanup_*()`，
 * 守卫会判为可写——这是对的。演练本身是**人工授权**动作，本模块只回答「能不能跑」，
 * 不替谁决定要不要写。
 *
 * 判定与网络无关：IO 在 `scripts/lib/cloud-sql-probe-check.js`。
 */

/** 顶层允许的首关键字。`explain analyze` 会真执行，所以 explain 不在列。 */
export const ALLOWED_FIRST_KEYWORDS: readonly string[] = ["select", "with", "show", "reset"];

/**
 * 出现在代码位（非注释、非字符串）就算「这条语句可能改状态」的关键字。
 * 覆盖 DML / DDL / 权限 / 会话设置，以及 PL/pgSQL 里能调函数的 `perform`
 * 和会建表的 `select … into`。
 */
export const WRITE_KEYWORDS: readonly string[] = [
  "insert", "update", "delete", "merge", "upsert", "create", "drop", "alter",
  "truncate", "grant", "revoke", "copy", "call", "execute", "do", "vacuum",
  "refresh", "reindex", "cluster", "comment", "lock", "prepare", "deallocate",
  "discard", "listen", "notify", "unlisten", "checkpoint", "reassign", "set",
  "perform", "into",
];

const DOLLAR_TAG = /^\$[A-Za-z0-9_]*\$/;
/** `E'…'` 里的反斜杠会转义引号，本扫描器不处理这种形状——遇到就拒，不猜。 */
const ESCAPE_STRING = /(?:^|[^\w$])e\s*'/i;

/** 一次扫描的产物：抹掉非代码位的副本、dollar-quote 块体、以及读不懂的原因。 */
interface ScanResult {
  /** 与入参**等长**：注释、字符串字面量、dollar-quote 块体全部换成空格。 */
  masked: string;
  bodies: string[];
  unterminated: string | null;
}

/**
 * 把「不是代码」的部分抹成空格，并顺手收集顶层 dollar-quote 的块体。
 *
 * 等长是硬要求：调用方拿 `masked` 的下标去切原始 SQL。
 */
function scanSql(sql: string): ScanResult {
  const masked: string[] = [];
  const bodies: string[] = [];
  let index = 0;
  let unterminated: string | null = null;

  while (index < sql.length) {
    const char = sql[index];
    const next = index + 1 < sql.length ? sql[index + 1] : "";

    if (char === "-" && next === "-") {
      const newline = sql.indexOf("\n", index);
      const stop = newline === -1 ? sql.length : newline;
      masked.push(" ".repeat(stop - index));
      index = stop;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = sql.indexOf("*/", index + 2);
      if (end === -1) {
        unterminated = "块注释没有闭合";
        masked.push(" ".repeat(sql.length - index));
        break;
      }
      masked.push(" ".repeat(end + 2 - index));
      index = end + 2;
      continue;
    }
    if (char === "'") {
      const closed = findStringEnd(sql, index);
      if (closed === null) {
        unterminated = "单引号没有闭合";
        masked.push(" ".repeat(sql.length - index));
        break;
      }
      masked.push(" ".repeat(closed - index));
      index = closed;
      continue;
    }
    const tag = DOLLAR_TAG.exec(sql.slice(index));
    if (tag) {
      const closed = findDollarEnd(sql, index, tag[0]);
      if (closed === null) {
        unterminated = `dollar-quote ${tag[0]} 没有闭合`;
        masked.push(" ".repeat(sql.length - index));
        break;
      }
      bodies.push(sql.slice(index + tag[0].length, closed));
      masked.push(" ".repeat(closed + tag[0].length - index));
      index = closed + tag[0].length;
      continue;
    }
    masked.push(char);
    index += 1;
  }

  return { masked: masked.join(""), bodies, unterminated };
}

/** 找单引号串的结束位置（闭合引号**之后**的下标）；未闭合返回 null。 */
function findStringEnd(sql: string, start: number): number | null {
  let cursor = start + 1;
  while (cursor < sql.length) {
    if (sql[cursor] === "'") {
      // `''` 是字面量里的单引号，不是闭合。
      if (sql[cursor + 1] === "'") {
        cursor += 2;
        continue;
      }
      return cursor + 1;
    }
    cursor += 1;
  }
  return null;
}

/** 找 dollar-quote 闭标签的起始下标；未闭合返回 null。 */
function findDollarEnd(sql: string, start: number, tag: string): number | null {
  const found = sql.indexOf(tag, start + tag.length);
  return found === -1 ? null : found;
}

/** 一条顶层语句。`masked` 与 `text` 等长、同起点。 */
export interface TopLevelStatement {
  text: string;
  masked: string;
  /** 这条语句里出现的顶层 dollar-quote 块体（DO 块用它取块体）。 */
  bodies: string[];
}

/** 按**顶层**分号切语句（分号只在 `masked` 的代码位上才算数）。 */
export function splitTopLevelStatements(sql: string): {
  statements: TopLevelStatement[];
  unterminated: string | null;
} {
  const scan = scanSql(sql);
  if (scan.unterminated) return { statements: [], unterminated: scan.unterminated };

  const statements: TopLevelStatement[] = [];
  let cursor = 0;
  for (let index = 0; index < scan.masked.length; index += 1) {
    if (scan.masked[index] !== ";") continue;
    pushStatement(statements, sql, scan.masked, cursor, index, scan.bodies);
    cursor = index + 1;
  }
  pushStatement(statements, sql, scan.masked, cursor, scan.masked.length, scan.bodies);
  return { statements, unterminated: null };
}

function pushStatement(
  out: TopLevelStatement[],
  sql: string,
  masked: string,
  from: number,
  to: number,
  bodies: string[],
) {
  const sliceMasked = masked.slice(from, to);
  const first = sliceMasked.search(/\S/);
  if (first === -1) return;
  let last = sliceMasked.length - 1;
  while (last > first && /\s/.test(sliceMasked[last])) last -= 1;
  out.push({
    text: sql.slice(from + first, to).trim(),
    masked: sliceMasked.slice(first, last + 1),
    bodies,
  });
}

/** 取一条语句的首关键字（已去掉前导括号与空白）；取不到返回空串。 */
export function firstKeyword(maskedStatement: string): string {
  const match = /^[a-z]+/i.exec(maskedStatement.replace(/^[(\s]+/, ""));
  return match ? match[0].toLowerCase() : "";
}

/** 在**代码位**文本里找写入关键字。入参必须是已抹掉注释/字符串/块体的 masked。 */
export function findWriteKeyword(maskedCode: string): string | null {
  for (const keyword of WRITE_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`, "i").test(maskedCode)) return keyword;
  }
  return null;
}

/** 递归收集一个块体内部所有 dollar-quote 块体（正本里有 `$fn$ … $$ … $$ … $fn$` 这种嵌套）。 */
function collectBodies(body: string, into: string[]): string | null {
  const scan = scanSql(body);
  if (scan.unterminated) return scan.unterminated;
  for (const nested of scan.bodies) {
    into.push(nested);
    const error = collectBodies(nested, into);
    if (error) return error;
  }
  return null;
}

/** 守卫的判定结果。 */
export interface ReadOnlyVerdict {
  sql: string;
  readOnly: boolean;
  reasons: string[];
}

function refuse(sql: string, reasons: string[]): ReadOnlyVerdict {
  return { sql, readOnly: false, reasons };
}

/** 一条 SQL 是否**可证只读**。失败封闭：判不出来就是 false。 */
export function assertProbeSqlReadOnly(sql: string): ReadOnlyVerdict {
  const trimmed = sql.trim();
  if (trimmed.length === 0) return refuse(sql, ["空语句"]);
  if (ESCAPE_STRING.test(trimmed)) return refuse(sql, ["含 E'' 转义字符串，守卫不认识这种形状"]);

  const { statements, unterminated } = splitTopLevelStatements(trimmed);
  if (unterminated) return refuse(sql, [unterminated]);
  if (statements.length === 0) return refuse(sql, ["没有可识别的语句"]);

  const reasons: string[] = [];
  for (const statement of statements) {
    const keyword = firstKeyword(statement.masked);
    if (keyword === "do") {
      const verdict = checkDoBlock(statement, reasons);
      if (verdict) reasons.push(verdict);
      continue;
    }
    if (!ALLOWED_FIRST_KEYWORDS.includes(keyword)) {
      reasons.push(
        `首关键字 ${keyword || "(无)"} 不在只读白名单（${ALLOWED_FIRST_KEYWORDS.join("/")}）`,
      );
      continue;
    }
    const offender = findWriteKeyword(statement.masked);
    if (offender) reasons.push(`语句代码位含 ${offender.toUpperCase()}`);
  }
  return { sql, readOnly: reasons.length === 0, reasons };
}

/** 检查一个 DO 块：块体本身要再过一遍黑名单。返回 null 表示没问题。 */
function checkDoBlock(statement: TopLevelStatement, reasons: string[]): string | null {
  // 块体之外的代码位只允许 `do` 与空白/标签残留。
  const offender = findWriteKeyword(statement.masked.replace(/\bdo\b/i, ""));
  if (offender) return `DO 语句块体之外含 ${offender.toUpperCase()}`;
  if (statement.bodies.length === 0) return "DO 块取不到块体，无法判断它做了什么";

  const nested: string[] = [];
  for (const body of statement.bodies) {
    const error = collectBodies(body, nested);
    if (error) return error;
    const inner = scanSql(body);
    if (inner.unterminated) return `DO 块体：${inner.unterminated}`;
    const hit = findWriteKeyword(inner.masked);
    if (hit) return `DO 块体内含 ${hit.toUpperCase()}，可能改状态`;
    for (const deep of inner.bodies) {
      const deepScan = scanSql(deep);
      if (deepScan.unterminated) return `DO 块体的嵌套块：${deepScan.unterminated}`;
      const deepHit = findWriteKeyword(deepScan.masked);
      if (deepHit) return `DO 块体的嵌套块内含 ${deepHit.toUpperCase()}`;
    }
  }
  return null;
}

/** 探测步骤的意图标识——写进读数，便于文档逐条引用。 */
export type ProbeStepId =
  | "READ_ONLY_ENDPOINT"
  | "WRITE_ENDPOINT_GUARDED"
  | "MULTI_STATEMENT"
  | "MULTI_STATEMENT_CONTROL"
  | "MULTI_STATEMENT_FIRST_EFFECT"
  | "SINGLE_DO_BLOCK";

/** 这一步「成功」长什么样。DO 块那条**期望服务端报错**——报错才是它跑通了的证据。 */
export type ProbeExpectation =
  | { kind: "rows" }
  | { kind: "exception"; marker: string }
  /**
   * 要求**响应至少花了这么久**——用来证明「排在前面的语句真的执行了」。
   *
   * 为什么需要这第四种判据：`MULTI_STATEMENT` 实测只回最后一条的结果
   * （`[{"second_ok":2}]`，run 38328251418）。这有两种解释：
   * 「两条都跑了、只回最后一条」与「只跑了最后一条」。
   * 两者的**响应完全相同**，光看响应体分不出来——而如果是后者，
   * 把多语句演练 SQL 交给这个端点就是**静默少跑**，
   * 那比跑不了更坏（演练会报告「通过」，而它其实什么都没做）。
   * `pg_sleep` 不改任何状态，所以用墙钟时间区分这两种是**纯只读**的手段。
   */
  | { kind: "slower_than"; minMs: number; controlStepId: ProbeStepId };

export interface ProbeStep {
  id: ProbeStepId;
  /** 实际送进 `query` 字段的 SQL。全部为常量，不接受外部输入。 */
  sql: string;
  endpoint: "read-only" | "query";
  /** 是否带 `read_only: true`（仅对 `query` 端点有意义）。 */
  readOnlyFlag: boolean;
  expectation: ProbeExpectation;
  /** 这一步想回答什么。 */
  question: string;
}

/** DO 块的报告通道。本仓库 2026-10-13 实测：`raise notice` 不回传，只能借 exception。 */
export const PROBE_MARKER = "PROBE-RESULT";

/**
 * 探测计划：四条，顺序即执行顺序。每条都设计成**不改变任何状态**。
 *
 * 前两条只验「能不能执行」，后两条才是 issue #245 与 B04 真正要的答案。
 */
export const PROBE_PLAN: readonly ProbeStep[] = [
  {
    id: "READ_ONLY_ENDPOINT",
    sql: "select 1 as probe_ok",
    endpoint: "read-only",
    readOnlyFlag: false,
    expectation: { kind: "rows" },
    question: "只读端点能否执行 SQL（令牌有没有 database_read）",
  },
  {
    id: "WRITE_ENDPOINT_GUARDED",
    sql: "select 1 as probe_ok",
    endpoint: "query",
    readOnlyFlag: true,
    expectation: { kind: "rows" },
    question: "写端点在 read_only=true 下能否执行 SQL",
  },
  {
    id: "MULTI_STATEMENT",
    sql: "select 1 as first_ok; select 2 as second_ok",
    endpoint: "query",
    readOnlyFlag: true,
    expectation: { kind: "rows" },
    question: "两条语句会不会撞上 prepared statement 限制（issue #245 的核心）",
  },
  {
    // **对照组**：与下一条同形状（两条 select、同一个端点、同样带 read_only），
    // 唯一区别是把 `pg_sleep(1)` 换成一个不睡眠的表达式。
    // 没有它，「2547ms ≥ 700ms」这句话是**没有基线的**——
    // 如果这个 API 一次普通往返本来就要 2.5 秒，那 2547ms 什么都没证明。
    id: "MULTI_STATEMENT_CONTROL",
    sql: "select 1 as ctl_one; select 2 as ctl_two",
    endpoint: "query",
    readOnlyFlag: true,
    expectation: { kind: "rows" },
    question: "同样两条语句、但不含 pg_sleep 时花多久（给下一条当基线）",
  },
  {
    id: "MULTI_STATEMENT_FIRST_EFFECT",
    // pg_sleep 不写任何东西；它唯一的作用是让「第一条跑过」这件事留下时间痕迹。
    sql: "select pg_sleep(1) as slow_one; select 2 as fast_two",
    endpoint: "query",
    readOnlyFlag: true,
    expectation: { kind: "slower_than", minMs: 700, controlStepId: "MULTI_STATEMENT_CONTROL" },
    question: "多语句里排在前面的那条到底有没有执行（静默少跑 vs 只回最后一条）",
  },
  {
    id: "SINGLE_DO_BLOCK",
    sql: `do $probe$ begin raise exception '${PROBE_MARKER} ok'; end $probe$;`,
    endpoint: "query",
    readOnlyFlag: true,
    expectation: { kind: "exception", marker: PROBE_MARKER },
    question: "一条 DO 块能否跑通（B04 正本正是单条 DO 块形态）",
  },
];

/** 守卫审计：整份计划必须全部可证只读，否则一条都不许发。 */
export interface PlanAudit {
  ok: boolean;
  rejections: { id: ProbeStepId; reasons: string[] }[];
}

export function auditProbePlan(plan: readonly ProbeStep[] = PROBE_PLAN): PlanAudit {
  const rejections: PlanAudit["rejections"] = [];
  for (const step of plan) {
    const verdict = assertProbeSqlReadOnly(step.sql);
    if (!verdict.readOnly) rejections.push({ id: step.id, reasons: verdict.reasons });
  }
  return { ok: rejections.length === 0, rejections };
}

/** 单步的原始返回（由 IO 层填充）。 */
export interface ProbeResponse {
  status: number;
  json: unknown;
  bodyText: string;
  /** 传输层失败（超时 / DNS / 连接被拒）——此时 status 为 0。 */
  transportError: string | null;
  /**
   * 本次请求花了多久。**`slower_than` 判据唯一依赖它**，
   * 所以缺省值是 0（「没测到」）而不是一个看起来合理的数——
   * 拿不到耗时的话那条判据必须落到 UNKNOWN，不能猜。
   */
  elapsedMs?: number;
}

export type ProbeOutcome =
  /** 这一步的判据满足了（DO 块那条 = 服务端把 PROBE-RESULT 报回来了）。 */
  | "EXECUTED"
  | "REFUSED_AUTH"
  | "REJECTED_SQL"
  | "RATE_LIMITED"
  /** 读不懂：非预期状态码、形状变了、或传输层失败。 */
  | "UNKNOWN";

export interface ProbeVerdict {
  id: ProbeStepId;
  outcome: ProbeOutcome;
  status: number;
  /** 给文档引用的短证据。 */
  evidence: string;
  /** 本次请求的真实耗时；拿不到就是 undefined（不是 0——0 会被读成「极快」）。 */
  elapsedMs?: number;
}

/** 从响应体里尽量取一段可读文本（截断，避免把整页 HTML 抄进日志）。 */
function errorTextOf(response: ProbeResponse): string {
  const raw = (response.bodyText ?? "").trim();
  if (response.json !== null && typeof response.json === "object") {
    const value = response.json as Record<string, unknown>;
    for (const key of ["error", "message", "detail", "msg"]) {
      if (typeof value[key] === "string") return (value[key] as string).slice(0, 300);
    }
    return JSON.stringify(value).slice(0, 300);
  }
  return raw.slice(0, 300);
}

/** 这一步的判据是否被满足。 */
function expectationMet(step: ProbeStep, response: ProbeResponse): boolean {
  const text = `${response.status} ${errorTextOf(response)}`;
  if (step.expectation.kind === "exception") {
    return text.toLowerCase().includes(step.expectation.marker.toLowerCase());
  }
  if (step.expectation.kind === "slower_than") {
    // 只有「确实拿到了耗时」才算数；elapsedMs 缺失 ⇒ 交给下面的 UNKNOWN 分支。
    if (typeof response.elapsedMs !== "number") return false;
    return response.elapsedMs >= step.expectation.minMs;
  }
  return Array.isArray(response.json);
}

/**
 * 把一步的原始响应判成结论。
 *
 * 「未知」是独立结论，既不被压成「没跑通」也不被压成「跑通了」——
 * 本仓库吃过太多次把「读不到」写成「不存在」的亏。
 */
/**
 * 把**真实耗时**前置进每一条证据。
 *
 * 为什么每条都记而不只记判据依赖的那一条：`MULTI_STATEMENT_FIRST_EFFECT` 的结论
 * 是「前序语句确实执行了」，依据是墙钟耗时。一个**孤立的**耗时数不构成证据——
 * 如果这个 API 一次普通往返本来就要 2.5 秒，那 `elapsed=2547ms` 什么都没证明。
 * 只有把对照组（同形状、不睡眠）的耗时一起打出来，这个结论才可核对。
 *
 * 第一版正是这样错的：判据用了 `elapsedMs`，输出里却根本没有这个数（run 38329527421）。
 */
function withElapsed(step: ProbeStep, response: ProbeResponse, text: string): string {
  if (typeof response.elapsedMs !== "number") return text;
  const floor = step.expectation.kind === "slower_than" ? ` ≥ ${step.expectation.minMs}ms` : "";
  return `[elapsed=${response.elapsedMs}ms${floor}] ${text}`;
}

export function classifyProbeResponse(step: ProbeStep, response: ProbeResponse): ProbeVerdict {
  return stampElapsed(classifyStep(step, response), response);
}

/** 把耗时抄进结论对象，供 `summarizeProbe` 做配对比较。 */
function stampElapsed(verdict: ProbeVerdict, response: ProbeResponse): ProbeVerdict {
  return typeof response.elapsedMs === "number"
    ? { ...verdict, elapsedMs: response.elapsedMs }
    : verdict;
}

function classifyStep(step: ProbeStep, response: ProbeResponse): ProbeVerdict {
  if (response.transportError) {
    return {
      id: step.id,
      outcome: "UNKNOWN",
      status: 0,
      evidence: `传输层失败：${response.transportError}`.slice(0, 300),
    };
  }
  const text = errorTextOf(response);
  if (response.status === 401 || response.status === 403) {
    return {
      id: step.id,
      outcome: "REFUSED_AUTH",
      status: response.status,
      evidence: text || `HTTP ${response.status}`,
    };
  }
  if (response.status === 429) {
    return { id: step.id, outcome: "RATE_LIMITED", status: 429, evidence: text };
  }
  // 判据先于状态码：DO 块那条**就是靠服务端报错**证明它跑到了执行阶段。
  if (expectationMet(step, response)) {
    return {
      id: step.id,
      outcome: "EXECUTED",
      status: response.status,
      evidence: withElapsed(step, response, text),
    };
  }
  if (step.expectation.kind === "slower_than" && response.status === 201) {
    if (typeof response.elapsedMs !== "number") {
      return {
        id: step.id,
        outcome: "UNKNOWN",
        status: 201,
        evidence: "201 但没有耗时读数，无法判断前序语句是否执行",
      };
    }
    // 201 且明显比 sleep 短 ⇒ 前序语句**没跑**。这是最危险的读数，必须单列。
    return {
      id: step.id,
      outcome: "REJECTED_SQL",
      status: 201,
      evidence: withElapsed(
        step,
        response,
        "[FIRST_STATEMENT_SKIPPED] 多语句里前面的语句被静默跳过",
      ),
    };
  }
  if ([400, 422, 500].includes(response.status)) {
    const prepared = text.toLowerCase().includes("prepared statement");
    return {
      id: step.id,
      outcome: "REJECTED_SQL",
      status: response.status,
      // 单独标出 prepared statement：那正是 issue #245 要的答案。
      evidence: `${prepared ? "[PREPARED_STATEMENT] " : ""}${text}`,
    };
  }
  return {
    id: step.id,
    outcome: "UNKNOWN",
    status: response.status,
    evidence: `HTTP ${response.status} ${text}`.slice(0, 300),
  };
}

/**
 * 睡眠那条是否**明显**慢于对照组。
 *
 * 判据是「至少慢 500ms」而不是「大于」：网络抖动几百毫秒在这个端点上是常态
 * （本仓库 2026-10-05 就记过 alias 切换后第一次探测会假失败），
 * 用「>」会让一次抖动就把「前序语句没跑」这个坏结论翻成好结论。
 * 任一侧缺耗时读数 ⇒ false（**不知道不等于通过**）。
 */
export function sleepsPastControl(
  firstEffect: ProbeVerdict | undefined,
  control: ProbeVerdict | undefined,
): boolean {
  if (!firstEffect || !control) return false;
  if (typeof firstEffect.elapsedMs !== "number") return false;
  if (typeof control.elapsedMs !== "number") return false;
  return firstEffect.elapsedMs - control.elapsedMs >= 500;
}

/** 一份计划跑完的总结论。 */
export interface ProbeReport {
  verdicts: ProbeVerdict[];
  /** 只读端点可用。 */
  readOnlyEndpointWorks: boolean;
  /** 写端点在 read_only 下可用。 */
  writeEndpointWorks: boolean;
  /** 多语句被接受 ⇒ issue #245 的答案是「限制在 CLI 侧」。 */
  multiStatementWorks: boolean;
  /** 多语句被拒且错误提到 prepared statement ⇒ 答案反过来。 */
  multiStatementBlocked: boolean;
  /** 单条 DO 块跑通 ⇒ B04 不再需要数据库密码。 */
  singleDoBlockWorks: boolean;
  /**
   * 多语句里**前面的语句确实执行了**（靠耗时证明）。
   * 与 `multiStatementWorks` 是两件事：后者只说明「没报 prepared statement 错」。
   */
  multiStatementFullyExecutes: boolean;
  /**
   * 睡眠那条**确实明显慢于对照组**——`multiStatementFullyExecutes` 成立的前提。
   *
   * 为什么单列：一个孤立的 `elapsed=2547ms` 不是证据。这个 API 一次普通往返
   * 本来就要一两秒的话，2547ms 什么都没证明。所以判据写成**配对差值**：
   * 同形状、同端点、只差一个 `pg_sleep(1)` 的两条请求，慢的那条才算真跑了 sleep。
   */
  sleepBeatsControl: boolean;
  /** 前序语句被静默跳过 ⇒ 这个端点**不能**用来跑多语句演练（比跑不了更坏）。 */
  multiStatementSkipsEarlier: boolean;
  /** 有没有任何一步是「不知道」。 */
  hasUnknown: boolean;
}

function outcomeOf(verdicts: ProbeVerdict[], id: ProbeStepId): ProbeOutcome | undefined {
  return verdicts.find((verdict) => verdict.id === id)?.outcome;
}

/** 汇总。纯函数：给定各步结论就能推出里程碑级判断，便于单测。 */
export function summarizeProbe(verdicts: ProbeVerdict[]): ProbeReport {
  const multi = verdicts.find((verdict) => verdict.id === "MULTI_STATEMENT");
  const firstEffect = verdicts.find((verdict) => verdict.id === "MULTI_STATEMENT_FIRST_EFFECT");
  const control = verdicts.find((verdict) => verdict.id === "MULTI_STATEMENT_CONTROL");
  return {
    verdicts,
    readOnlyEndpointWorks: outcomeOf(verdicts, "READ_ONLY_ENDPOINT") === "EXECUTED",
    writeEndpointWorks: outcomeOf(verdicts, "WRITE_ENDPOINT_GUARDED") === "EXECUTED",
    multiStatementWorks: multi?.outcome === "EXECUTED",
    multiStatementBlocked:
      multi?.outcome === "REJECTED_SQL" && multi.evidence.includes("PREPARED_STATEMENT"),
    singleDoBlockWorks: outcomeOf(verdicts, "SINGLE_DO_BLOCK") === "EXECUTED",
    sleepBeatsControl: sleepsPastControl(firstEffect, control),
    multiStatementFullyExecutes:
      firstEffect?.outcome === "EXECUTED" && sleepsPastControl(firstEffect, control),
    multiStatementSkipsEarlier:
      firstEffect?.outcome === "REJECTED_SQL" &&
      firstEffect.evidence.includes("FIRST_STATEMENT_SKIPPED"),
    hasUnknown: verdicts.some(
      (verdict) => verdict.outcome === "UNKNOWN" || verdict.outcome === "RATE_LIMITED",
    ),
  };
}

/**
 * 退出码：0 = 计划全部满足判据；1 = 至少一步被明确拒绝（那是**答案**，不是故障）；
 * 2 = 有任何一步「不知道」。**未知不算通过**，也不与「被拒」混为一谈。
 */
export function probeExitCode(report: ProbeReport): number {
  if (report.hasUnknown) return 2;
  const refused = report.verdicts.some((verdict) =>
    ["REFUSED_AUTH", "REJECTED_SQL"].includes(verdict.outcome),
  );
  // 配对判据单独算一次「不算通过」：睡眠那条自己报 EXECUTED、
  // 但没跑赢对照组时，退出码若是 0 就等于「全绿 + 一个关键结论为假」并存。
  // 这正是本仓库反复登记的那类失效——看起来像查过了。
  const sleepStepRan = outcomeOf(report.verdicts, "MULTI_STATEMENT_FIRST_EFFECT") === "EXECUTED";
  const pairingContradiction = sleepStepRan && !report.sleepBeatsControl;
  return refused || pairingContradiction ? 1 : 0;
}
