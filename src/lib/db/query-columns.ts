/**
 * Column-name parity for Supabase query chains.
 *
 * `database.types.ts` only types the *result* of a query. A misspelled column in
 * `.eq("user_id", …)` or `.order("started_at", …)` therefore type-checks fine, lints fine and
 * passes unit tests (the chain is mocked), and the mock query builder silently no-ops an
 * unknown `order` column instead of erroring. Against a real database the same string is a
 * 400 — so the only class of defect left unprotected by every other gate is a column name
 * that exists in no generated row type.
 *
 * This module compares the literal column names used in filter and ordering methods against
 * the `Row` types produced by `supabase gen types`. It is deliberately narrow:
 *
 * - Only `.from("<table>")` chains whose table is present in the generated types are judged;
 *   a chain on an unknown table is reported instead, because that is the same bug one level up.
 * - Only plain lowercase identifiers are judged. Anything PostgREST uses for richer addressing
 *   (`json->>path`, `->`, casing variants, `!inner`/embed hints, runtime expressions) is
 *   skipped, because those are valid strings that no row type contains.
 * - A chain that embeds another table is skipped entirely: once a query flattens a relation,
 *   `Row` of the base table stops being the set of valid addresses.
 *
 * Every skipped chain and skipped argument is counted, and the caller fails closed when the
 * parse yields nothing — a gate that quietly stopped reading the codebase must not report green.
 */

import ts from "typescript";

export interface QueryColumnSource {
  /** Repository-relative POSIX path, e.g. `src/lib/repositories/notifications.ts`. */
  file: string;
  content: string;
}

export interface QueryTable {
  table: string;
  columns: string[];
}

/** A single literal column address used against a known table. */
export interface QueryColumnCheck {
  file: string;
  line: number;
  table: string;
  method: string;
  column: string;
}

/**
 * Methods whose first argument addresses a column of the queried table.
 *
 * `.filter()` / `.or()` / `.match()` are excluded: `.filter()` and `.or()` take a mini
 * expression language (`and(col.eq.x)`, `col.gt.5`) and `.match()` takes an object, so none of
 * them has a bare column name to read.
 */
export const COLUMN_ADDRESS_METHODS: ReadonlySet<string> = new Set([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "is",
  "in",
  "like",
  "ilike",
  "order",
]);

/** Methods whose argument is a comma-separated list of columns rather than exactly one. */
export const COLUMN_LIST_METHODS: ReadonlySet<string> = new Set(["select"]);

/** Every method this gate reads, so the coverage counters can't drift from the rule set. */
export const JUDGED_METHODS: ReadonlySet<string> = new Set([
  ...COLUMN_ADDRESS_METHODS,
  ...COLUMN_LIST_METHODS,
]);

export type QueryColumnIssueCode =
  | "QUERY_TABLE_UNKNOWN"
  | "QUERY_COLUMN_NOT_IN_TABLE"
  | "QUERY_TYPES_UNREADABLE"
  | "QUERY_COLUMN_GATE_VACUOUS";

export interface QueryColumnIssue {
  code: QueryColumnIssueCode;
  message: string;
}

export interface QueryColumnStats {
  /** Tables read out of the generated types. */
  tables: number;
  /** `.from("<literal>")` call sites found in the scanned sources. */
  fromCalls: number;
  /** Literal column addresses judged against a generated row type. */
  checked: number;
  /** Chains left alone because they embed a relation. */
  skippedEmbedded: number;
  /** Arguments left alone because they are not plain column identifiers. */
  skippedArguments: number;
}

export interface QueryColumnReport {
  issues: QueryColumnIssue[];
  stats: QueryColumnStats;
}

/** What this gate is willing to call a column name: a bare identifier, no path, hint or cast. */
const PLAIN_COLUMN = /^[a-z][a-zA-Z0-9_]*$/;

export interface ColumnAddress {
  /** Bare column names this argument addresses. */
  columns: string[];
  /** Addresses this gate refuses to judge, kept for the coverage counters. */
  exotic: string[];
}

/**
 * Read the column names out of a filter, order or select argument.
 *
 * PostgREST overloads these strings with things no row type contains — `*`, `alias:column`,
 * JSON paths (`metadata->>role`), casts (`col::text`), embed hints (`profiles!inner(id)`) — so
 * each token is judged on its own and the rest are reported as unaddressable rather than
 * guessed at. A typo must not be able to hide inside an exotic token.
 */
export function readColumnAddress(method: string, value: string): ColumnAddress {
  const tokens = COLUMN_LIST_METHODS.has(method) ? value.split(",") : [value];
  const columns: string[] = [];
  const exotic: string[] = [];

  for (const raw of tokens) {
    const token = raw.trim();
    if (!token) continue;
    if (PLAIN_COLUMN.test(token)) {
      columns.push(token);
      continue;
    }
    // `alias:column` — the alias names the output field; the column behind it is what is read.
    const aliased = /^[\w-]+:(.+)$/.exec(token);
    if (aliased && PLAIN_COLUMN.test(aliased[1].trim())) {
      columns.push(aliased[1].trim());
      continue;
    }
    exotic.push(token);
  }

  return { columns, exotic };
}

function scriptKind(fileName: string): ts.ScriptKind {
  return fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function parse(fileName: string, content: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  );
}

function lineOf(parsed: ts.SourceFile, node: ts.Node): number {
  return parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
}

/** Literal string argument, or `null` for anything else (identifiers, objects, template holes). */
function literalStringArgument(call: ts.CallExpression): string | null {
  const argument = call.arguments[0];
  if (!argument) return null;
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
    return argument.text;
  }
  return null;
}

/** A named member of a type literal or an object literal, with the node holding its value. */
interface NamedMember {
  name: string;
  value: ts.Node;
}

/**
 * Members of a `Tables`-shaped container.
 *
 * `supabase gen types` emits type literals (`Row: { id: string }`), while a hand-written
 * snapshot of the same shape uses object literals; both are accepted so the gate reads the
 * same structure either way.
 */
function namedMembers(node: ts.Node, parsed: ts.SourceFile): NamedMember[] {
  if (ts.isTypeLiteralNode(node)) {
    return node.members
      .filter(ts.isPropertySignature)
      .filter((member) => member.type)
      .map((member) => ({ name: member.name.getText(parsed), value: member.type as ts.Node }));
  }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties
      .filter(ts.isPropertyAssignment)
      .map((member) => ({ name: member.name.getText(parsed), value: member.initializer }));
  }
  return [];
}

function memberNamed(members: NamedMember[], name: string): NamedMember | undefined {
  return members.find((member) => member.name === name);
}

/**
 * Read the `Tables` and `Views` blocks of a generated `Database` type.
 *
 * Generated files nest both blocks under each schema (`public`, `auth`, …), so every such
 * member in the file is harvested rather than a hard-coded path — a schema addition should
 * widen the gate, not break it. Views count because PostgREST addresses them exactly like
 * tables on the read side; an entry whose `Row` this pass cannot expand (e.g. a type
 * reference instead of a literal) is dropped rather than kept with zero columns, which would
 * turn every column of that relation into a false positive.
 */
export function parseGeneratedTables(typesContent: string): QueryTable[] {
  const parsed = parse("database.types.ts", typesContent);
  const tables: QueryTable[] = [];

  const visit = (node: ts.Node): void => {
    for (const block of namedMembers(node, parsed)) {
      if (block.name !== "Tables" && block.name !== "Views") continue;
      for (const entry of namedMembers(block.value, parsed)) {
        const row = memberNamed(namedMembers(entry.value, parsed), "Row");
        if (!row) continue;
        const columns = namedMembers(row.value, parsed).map((column) => column.name);
        if (columns.length === 0) continue;
        tables.push({ table: entry.name, columns });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(parsed);
  return dedupeTables(tables).sort((a, b) => a.table.localeCompare(b.table));
}

/** Two schemas can each declare a table of the same name; the gate accepts either column set. */
function dedupeTables(tables: QueryTable[]): QueryTable[] {
  const byTable = new Map<string, Set<string>>();
  for (const entry of tables) {
    const columns = byTable.get(entry.table) ?? new Set<string>();
    for (const column of entry.columns) columns.add(column);
    byTable.set(entry.table, columns);
  }
  return [...byTable].map(([table, columns]) => ({ table, columns: [...columns].sort() }));
}

/** True when a `.select()`/`.insert()` list addresses an embedded relation, e.g. `profiles(id)`. */
function hasEmbeddedResource(chain: ts.CallExpression[]): boolean {
  return chain.some((call) => {
    const value = literalStringArgument(call);
    return value !== null && /[a-zA-Z_][a-zA-Z0-9_]*\s*\(/.test(value);
  });
}

/** Every call in the fluent chain that `from` belongs to, innermost first. */
function chainOf(fromCall: ts.CallExpression): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [fromCall];
  let current: ts.Node = fromCall;
  for (;;) {
    const member: ts.Node | undefined = current.parent;
    if (!member || !ts.isPropertyAccessExpression(member) || member.expression !== current) break;
    const parent: ts.Node | undefined = member.parent;
    if (!parent || !ts.isCallExpression(parent) || parent.expression !== member) break;
    current = parent;
    calls.push(parent);
  }
  return calls;
}

/** `.order(...)` → `order`; a computed or namespaced call → `null`. */
function methodName(call: ts.CallExpression): string | null {
  return ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : null;
}

/**
 * True for `client.storage.from("avatars")`.
 *
 * Storage reuses the same `.from("<name>")` shape for buckets, and a bucket is not a table:
 * `avatars` appears in no generated row type and must not be judged like one.
 */
function isStorageFromCall(call: ts.CallExpression): boolean {
  const fromMember = call.expression;
  if (!ts.isPropertyAccessExpression(fromMember)) return false;
  const receiver = fromMember.expression;
  if (ts.isPropertyAccessExpression(receiver)) return receiver.name.text === "storage";
  return ts.isIdentifier(receiver) && receiver.text === "storage";
}

/**
 * The `.from("<known table>")` call this node is, or `null` when it isn't one.
 *
 * Guard clauses live here so the traversal below stays a two-level decision instead of a
 * pyramid of `&&` checks wrapped in the AST visitor's loops.
 */
function knownTableFromCall(
  node: ts.Node,
  knownTables: ReadonlySet<string>,
): { call: ts.CallExpression; table: string } | null {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return null;
  if (node.expression.name.text !== "from" || isStorageFromCall(node)) return null;
  const table = literalStringArgument(node);
  return table !== null && knownTables.has(table) ? { call: node, table } : null;
}

/** Column addresses inside one query chain, plus how many addresses were left unjudged. */
function chainColumnChecks(
  chain: ts.CallExpression[],
  readLine: (call: ts.CallExpression) => number,
): { items: { method: string; column: string; line: number }[]; skippedArguments: number } {
  const items: { method: string; column: string; line: number }[] = [];
  let skippedArguments = 0;

  for (const call of chain) {
    const method = methodName(call);
    if (!method || !JUDGED_METHODS.has(method)) continue;
    const argument = literalStringArgument(call);
    if (argument === null) {
      skippedArguments += 1;
      continue;
    }
    const address = readColumnAddress(method, argument);
    for (const column of address.columns) {
      items.push({ method, column, line: readLine(call) });
    }
    skippedArguments += address.exotic.length;
  }

  return { items, skippedArguments };
}

export interface CollectedQueryFacts {
  checks: QueryColumnCheck[];
  fromCalls: number;
  skippedEmbedded: number;
  skippedArguments: number;
}

/** Inventory every literal column address per `.from("<table>")` chain. */
export function collectQueryFacts(
  sources: QueryColumnSource[],
  knownTables: ReadonlySet<string>,
): CollectedQueryFacts {
  const checks: QueryColumnCheck[] = [];
  let fromCalls = 0;
  let skippedEmbedded = 0;
  let skippedArguments = 0;

  for (const source of sources) {
    const parsed = parse(source.file, source.content);

    const visit = (node: ts.Node): void => {
      const query = knownTableFromCall(node, knownTables);
      if (query) {
        fromCalls += 1;
        const chain = chainOf(query.call);
        if (hasEmbeddedResource(chain)) {
          skippedEmbedded += 1;
        } else {
          const analysed = chainColumnChecks(chain, (call) => lineOf(parsed, call));
          for (const item of analysed.items) {
            checks.push({
              file: source.file,
              line: item.line,
              table: query.table,
              method: item.method,
              column: item.column,
            });
          }
          skippedArguments += analysed.skippedArguments;
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(parsed);
  }

  return { checks, fromCalls, skippedEmbedded, skippedArguments };
}

/** `.from()` on a table the generated types do not know about is the same bug, one level up. */
export function collectUnknownTableCalls(
  sources: QueryColumnSource[],
  knownTables: ReadonlySet<string>,
): { file: string; line: number; table: string }[] {
  const found: { file: string; line: number; table: string }[] = [];

  for (const source of sources) {
    const parsed = parse(source.file, source.content);

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        if (node.expression.name.text === "from" && !isStorageFromCall(node)) {
          const table = literalStringArgument(node);
          if (table !== null && !knownTables.has(table)) {
            found.push({ file: source.file, line: lineOf(parsed, node), table });
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(parsed);
  }

  return found;
}

/**
 * Compare every literal column address with its table's generated row type.
 *
 * `sources` are the files in scope; `typesContent` is the generated `database.types.ts`.
 */
export function inspectQueryColumns(options: {
  sources: QueryColumnSource[];
  typesContent: string;
}): QueryColumnReport {
  const tables = parseGeneratedTables(options.typesContent);
  const columnsByTable = new Map(tables.map((entry) => [entry.table, new Set(entry.columns)]));
  const knownTables = new Set(tables.map((entry) => entry.table));

  const issues: QueryColumnIssue[] = [];
  if (tables.length === 0) {
    return {
      issues: [
        {
          code: "QUERY_TYPES_UNREADABLE",
          message:
            "generated database.types.ts exposes no `Tables` block with a `Row` type; the " +
            "column gate cannot judge anything and refuses to report green",
        },
      ],
      stats: { tables: 0, fromCalls: 0, checked: 0, skippedEmbedded: 0, skippedArguments: 0 },
    };
  }

  const facts = collectQueryFacts(options.sources, knownTables);
  const checked = new Set<string>();

  for (const check of facts.checks) {
    const key = `${check.file}:${check.line}:${check.column}`;
    if (checked.has(key)) continue;
    checked.add(key);
    const columns = columnsByTable.get(check.table);
    if (!columns || columns.has(check.column)) continue;
    issues.push({
      code: "QUERY_COLUMN_NOT_IN_TABLE",
      message:
        `${check.file}:${check.line} uses .${check.method}("${check.column}") against ` +
        `table ${check.table}, which has no such column in database.types.ts ` +
        `(columns: ${[...columns].sort().join(", ")})`,
    });
  }

  for (const unknown of collectUnknownTableCalls(options.sources, knownTables)) {
    issues.push({
      code: "QUERY_TABLE_UNKNOWN",
      message:
        `${unknown.file}:${unknown.line} queries table "${unknown.table}", which is not in ` +
        "the generated types — regenerate types or drop the query",
    });
  }

  const stats: QueryColumnStats = {
    tables: tables.length,
    fromCalls: facts.fromCalls,
    checked: facts.checks.length,
    skippedEmbedded: facts.skippedEmbedded,
    skippedArguments: facts.skippedArguments,
  };

  if (stats.checked === 0 && issues.length === 0) {
    // 只在其他方面都干净时补这一条：它的职责是阻止“无事可做却报绿”，不是第二份错误清单。
    issues.push({
      code: "QUERY_COLUMN_GATE_VACUOUS",
      message:
        "no literal column address was checked; the gate stopped reading the query chains it " +
        "exists to guard",
    });
  }

  return { issues: issues.sort((a, b) => a.message.localeCompare(b.message)), stats };
}
