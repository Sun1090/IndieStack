/**
 * Mock 文档一致性规则（I07）。
 *
 * 背景：`docs-site/mock.md`、`docs-site/zh-CN/mock.md` 与
 * `docs/architecture/13-mock-system.md` 长期只描述最早的六个表、把缓存说成
 * 「请求级」、并把路由分支写成已随 ADR-007 退役的 `middleware.ts`。文档没有门禁，
 * 于是 Mock 客户端每次扩表、proxy 改名、E2E 端点新增都不会有人回头改文档。
 *
 * 本模块把「文档必须与 mock 实现同步」固化为可执行规则，全部为纯函数：
 *
 *   - 客户端的每个表名必须出现在每份文档的「表名清单」里，反之亦然；
 *   - `src/app/api/e2e/*` 下的每个端点必须被文档登记，文档不得引用已删除的端点；
 *   - 「已实现的过滤器」那一行列出的算子必须与查询构建器真的写了 `this.filters[...]`
 *     的那一组**逐字相等**，两个方向都报错；
 *   - 每份文档必须覆盖开启条件、自动降级边界、proxy 接入点与状态重置入口；
 *   - 已核验为错的旧表述不得回流（STALE_DOC_CLAIMS）；
 *   - 抽取结果为空时失败封闭，避免正则失效被当成「零问题」。
 *
 * 规则只判断文档与代码的事实一致性，不判断文案质量。
 */

import * as ts from "typescript";

export type MockDocIssueCode =
  | "MOCK_TABLE_UNDOCUMENTED"
  | "MOCK_TABLE_UNKNOWN"
  | "MOCK_ENDPOINT_UNDOCUMENTED"
  | "MOCK_ENDPOINT_UNKNOWN"
  | "MOCK_FILTER_UNDOCUMENTED"
  | "MOCK_FILTER_UNSUPPORTED"
  | "MOCK_FILTER_ROW_MISSING"
  | "MOCK_REQUIRED_FACT_MISSING"
  | "MOCK_STALE_CLAIM"
  | "MOCK_DOC_SOURCE_EMPTY";

export interface MockDocIssue {
  code: MockDocIssueCode;
  document: string;
  detail: string;
}

export interface MockDocDocument {
  /** 仓库相对路径，仅用于报错定位。 */
  path: string;
  content: string;
}

export interface MockDocsInput {
  /** `src/lib/mock/index.ts` 源码，用于抽取客户端支持的表名。 */
  mockIndexSource: string;
  /** `src/app/api/e2e/<name>/route.ts` 的仓库相对路径列表。 */
  e2eRoutePaths: readonly string[];
  /** 需要与实现对齐的文档。 */
  documents: readonly MockDocDocument[];
}

export interface MockDocsReport {
  issues: MockDocIssue[];
  /** 从 mock 客户端抽出的表名（已排序）。 */
  tables: string[];
  /** 从 e2e 路由目录抽出的端点（已排序）。 */
  endpoints: string[];
  /** 查询构建器真的写入 `this.filters[...]` 的算子名（已排序）。 */
  filters: string[];
}

export interface MockDocPhrase {
  phrase: string;
  reason: string;
}

/** 每份文档都必须出现的事实锚点；写进文档才说明这些契约确实被说明过。 */
export const REQUIRED_DOC_FACTS: readonly MockDocPhrase[] = [
  { phrase: "NEXT_PUBLIC_MOCK_ENABLED", reason: "显式开启 Mock 的开关名" },
  { phrase: "NEXT_PUBLIC_SUPABASE_URL", reason: "自动降级只由该项缺失触发" },
  { phrase: "NODE_ENV", reason: "自动降级仅限非生产环境，文档必须写明边界" },
  { phrase: "src/proxy.ts", reason: "路由级 Mock 分支在 proxy，不是退役的 middleware.ts" },
  { phrase: "resetMockCache", reason: "进程级 Mock 缓存的重置入口" },
  { phrase: "/api/e2e/mock-reset", reason: "受 E2E_BEARER_TOKEN 保护的重置端点" },
  { phrase: "createMockRequestStore", reason: "需要并行隔离时使用的请求级原语" },
];

/**
 * 经核验为错的旧表述，不得回流到文档。
 * 该清单刻意保持最小：只登记已确认与实现矛盾、且容易在重写文档时复发的说法。
 */
export const STALE_DOC_CLAIMS: readonly MockDocPhrase[] = [
  {
    phrase: "cached per request",
    reason: "客户端缓存挂在 globalThis.__indiestackMockCache__ 上，是进程级而非请求级",
  },
  {
    phrase: "一次请求内保持缓存一致",
    reason: "客户端缓存挂在 globalThis.__indiestackMockCache__ 上，是进程级而非请求级",
  },
  {
    phrase: "所有路由保护失效",
    reason: "proxy 只跳过路由级重定向，页面级 requireRole/requirePermission 仍然生效",
  },
];

/** Mock 客户端的 `switch (this.table)` 分支即受支持的表名。 */
const CLIENT_TABLE_CASE = /case\s+"([a-z][a-z0-9_]*)":/g;
const E2E_ROUTE_PATH = /(?:^|\/)api\/e2e\/([a-z0-9-]+)\/route\.ts$/;
const E2E_ENDPOINT_REFERENCE = /\/api\/e2e\/[a-z0-9-]+/g;
const MARKDOWN_ROW_FIRST_CELL = /^\|([^|]*)\|/;
const MARKDOWN_SEPARATOR_ROW = /^\|[\s:|-]*-[\s:|-]*\|/;
const INLINE_CODE_TABLE_NAME = /^`([a-z][a-z0-9_]*)`$/;
const TABLE_LISTING_HEADERS = new Set(["表名", "数据表", "表清单"]);

/** 「已实现的过滤器」那一行第二格的开头；两份文档各用自己的语言写，都认。 */
const FILTER_ROW_HEADINGS = ["Implemented filters", "已实现的过滤器"] as const;

/**
 * 必须出现这一行的文档。`docs/architecture/13-mock-system.md` 刻意不在这里：
 * 它讲的是客户端怎么搭的，不列过滤器词汇表；但**只要它列了就必须对上**（见 auditFilterParity）。
 */
const FILTER_ROW_REQUIRED_DOCS = ["docs-site/mock.md", "docs-site/zh-CN/mock.md"] as const;

/**
 * 从 Mock 客户端源码抽取受支持的表名。
 * 目前 index.ts 只有按表名分支的字符串 switch；若将来新增其它字符串 switch，
 * 这里会把它当作未登记表名报错（失败封闭），需要同步文档或调整实现。
 */
export function extractClientTables(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(CLIENT_TABLE_CASE)) names.add(match[1]);
  return [...names].sort();
}

/**
 * Mock 查询构建器**真的实现了哪些过滤算子**——判据是方法体里有没有往
 * `this.filters[...]` 写条件，而不是数方法名。起因不是推测：`docs-site/mock.md` 与
 * 它的中文版长期写着「支持 `eq() / neq() / in() / is()`」，而 `neq()` 从来没实现，
 * 同期真正在用的 `gt()` 却没被登记（见 #149）。两侧都错过一次，说明「写进文档的词汇表」
 * 必须有东西回头对着实现核——本仓库的 Mock 客户端是唯一的替身，它的表面就是文档的上界。
 */
export function extractClientFilters(source: string): string[] {
  const file = ts.createSourceFile("mock-index.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = new Set<string>();
  const writesFilters = (node: ts.Node): boolean =>
    ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && ts.isElementAccessExpression(node.left)
    && ts.isPropertyAccessExpression(node.left.expression)
    && node.left.expression.name.text === "filters";
  const visit = (node: ts.Node): void => {
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.body) {
      let writes = false;
      const scan = (inner: ts.Node): void => {
        if (writesFilters(inner)) writes = true;
        ts.forEachChild(inner, scan);
      };
      scan(node.body);
      if (writes) names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...names].sort();
}

/**
 * 文档里那一行「已实现的过滤器 / Implemented filters」列出的算子名。
 * 返回 `null` 表示这份文档根本没有这一行（由调用方决定是缺失还是不检查）。
 */
export function extractDocumentedFilters(content: string): string[] | null {
  for (const line of content.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1);
    if (cells.length < 2) continue;
    const heading = cells[1].trim();
    if (!FILTER_ROW_HEADINGS.some((anchor) => heading.startsWith(anchor))) continue;
    return [...cells[0].matchAll(/`([a-z][A-Za-z]*)\(\)`/g)].map((match) => match[1]).sort();
  }
  return null;
}

/** 把 `src/app/api/e2e/<name>/route.ts` 归一化成 `/api/e2e/<name>`。 */
export function extractE2eEndpoints(routePaths: readonly string[]): string[] {
  const endpoints = new Set<string>();
  for (const routePath of routePaths) {
    const match = E2E_ROUTE_PATH.exec(routePath);
    if (match) endpoints.add(`/api/e2e/${match[1]}`);
  }
  return [...endpoints].sort();
}

function firstCell(line: string): string | null {
  const match = MARKDOWN_ROW_FIRST_CELL.exec(line);
  return match ? match[1].trim() : null;
}

function isSeparatorRow(line: string): boolean {
  return MARKDOWN_SEPARATOR_ROW.test(line.trim());
}

function isTableListingHeader(cell: string): boolean {
  const normalized = cell.replace(/[*`\s]/g, "").toLowerCase();
  return normalized === "table" || normalized === "tables" || TABLE_LISTING_HEADERS.has(normalized);
}

/**
 * 抽取文档里「表名清单」登记的表：只认首列表头为 table/表名 等标识、
 * 且后续数据行首列是行内代码形式的 markdown 表格，避免把示例代码里的表名当登记。
 */
export function extractDocumentedTables(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const names = new Set<string>();
  let insideTableListing = false;

  for (let index = 0; index < lines.length; index += 1) {
    const cell = firstCell(lines[index]);
    if (cell === null) {
      insideTableListing = false;
      continue;
    }
    if (!insideTableListing) {
      insideTableListing = isTableListingHeader(cell) && isSeparatorRow(lines[index + 1] ?? "");
      continue;
    }
    const name = INLINE_CODE_TABLE_NAME.exec(cell);
    if (name) names.add(name[1]);
  }

  return [...names].sort();
}

/** 抽取文档里引用到的所有 E2E 端点。 */
export function extractDocumentedEndpoints(markdown: string): string[] {
  return [...new Set(markdown.match(E2E_ENDPOINT_REFERENCE) ?? [])].sort();
}

function diffSets(expected: readonly string[], actual: readonly string[]) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  return {
    missing: expected.filter((name) => !actualSet.has(name)),
    unknown: actual.filter((name) => !expectedSet.has(name)),
  };
}

function auditTableParity(
  document: MockDocDocument,
  tables: readonly string[],
  issues: MockDocIssue[],
): void {
  const { missing, unknown } = diffSets(tables, extractDocumentedTables(document.content));
  for (const name of missing) {
    issues.push({
      code: "MOCK_TABLE_UNDOCUMENTED",
      document: document.path,
      detail: `客户端支持的表 ${name} 未登记在表名清单里`,
    });
  }
  for (const name of unknown) {
    issues.push({
      code: "MOCK_TABLE_UNKNOWN",
      document: document.path,
      detail: `文档登记了客户端不支持的表 ${name}`,
    });
  }
}

function auditEndpointParity(
  document: MockDocDocument,
  endpoints: readonly string[],
  issues: MockDocIssue[],
): void {
  const { missing, unknown } = diffSets(endpoints, extractDocumentedEndpoints(document.content));
  for (const endpoint of missing) {
    issues.push({
      code: "MOCK_ENDPOINT_UNDOCUMENTED",
      document: document.path,
      detail: `${endpoint} 存在但文档未登记`,
    });
  }
  for (const endpoint of unknown) {
    issues.push({
      code: "MOCK_ENDPOINT_UNKNOWN",
      document: document.path,
      detail: `${endpoint} 已被删除但文档仍在引用`,
    });
  }
}

function auditFilterParity(
  document: MockDocDocument,
  filters: readonly string[],
  issues: MockDocIssue[],
): void {
  const documented = extractDocumentedFilters(document.content);
  if (documented === null) {
    if ((FILTER_ROW_REQUIRED_DOCS as readonly string[]).includes(document.path)) {
      issues.push({
        code: "MOCK_FILTER_ROW_MISSING",
        document: document.path,
        detail: `没有「已实现的过滤器」这一行；实现里有 ${filters.length} 个算子，读者无从对照`,
      });
    }
    return;
  }
  const { missing, unknown } = diffSets(filters, documented);
  for (const name of missing) {
    issues.push({
      code: "MOCK_FILTER_UNDOCUMENTED",
      document: document.path,
      detail: `${name}() 在查询构建器里真的写 this.filters，但文档那一行没登记`,
    });
  }
  for (const name of unknown) {
    issues.push({
      code: "MOCK_FILTER_UNSUPPORTED",
      document: document.path,
      detail: `文档登记了 ${name}()，而 MockQueryBuilder 没有这个方法（一调用就是 TypeError）`,
    });
  }
}

function auditDocument(
  document: MockDocDocument,
  tables: readonly string[],
  endpoints: readonly string[],
  filters: readonly string[],
  issues: MockDocIssue[],
): void {
  auditTableParity(document, tables, issues);
  auditEndpointParity(document, endpoints, issues);
  auditFilterParity(document, filters, issues);
  for (const fact of REQUIRED_DOC_FACTS) {
    if (!document.content.includes(fact.phrase)) {
      issues.push({
        code: "MOCK_REQUIRED_FACT_MISSING",
        document: document.path,
        detail: `缺少事实锚点 ${fact.phrase}（${fact.reason}）`,
      });
    }
  }
  for (const claim of STALE_DOC_CLAIMS) {
    if (document.content.includes(claim.phrase)) {
      issues.push({
        code: "MOCK_STALE_CLAIM",
        document: document.path,
        detail: `出现已核验为错的表述「${claim.phrase}」：${claim.reason}`,
      });
    }
  }
}

function auditInputs(
  input: MockDocsInput,
  tables: string[],
  endpoints: string[],
  filters: string[],
  issues: MockDocIssue[],
) {
  if (input.documents.length === 0) {
    issues.push({ code: "MOCK_DOC_SOURCE_EMPTY", document: "-", detail: "没有传入需要校验的文档" });
  }
  if (tables.length === 0) {
    issues.push({
      code: "MOCK_DOC_SOURCE_EMPTY",
      document: "src/lib/mock/index.ts",
      detail: "未能从 Mock 客户端抽出任何表名，抽取规则可能已失效",
    });
  }
  if (endpoints.length === 0) {
    issues.push({
      code: "MOCK_DOC_SOURCE_EMPTY",
      document: "src/app/api/e2e",
      detail: "未能抽出任何 E2E 端点，抽取规则可能已失效",
    });
  }
  if (filters.length === 0) {
    issues.push({
      code: "MOCK_DOC_SOURCE_EMPTY",
      document: "src/lib/mock/index.ts",
      detail: "未能从查询构建器抽出任何过滤算子，`this.filters[...]` 的写法可能已改，抽取规则失效",
    });
  }
}

/** 审计 Mock 文档与实现的一致性；纯函数，不读取文件系统。 */
export function auditMockDocs(input: MockDocsInput): MockDocsReport {
  const tables = extractClientTables(input.mockIndexSource);
  const endpoints = extractE2eEndpoints(input.e2eRoutePaths);
  const filters = extractClientFilters(input.mockIndexSource);
  const issues: MockDocIssue[] = [];

  auditInputs(input, tables, endpoints, filters, issues);
  for (const document of input.documents) {
    auditDocument(document, tables, endpoints, filters, issues);
  }

  return { issues, tables, endpoints, filters };
}

/** 格式化为带规则码的文本，供 CLI 和测试复用。 */
export function formatMockDocIssues(issues: readonly MockDocIssue[]): string {
  return issues.map((item) => `❌ [${item.code}] ${item.document} ${item.detail}`).join("\n");
}
