/**
 * 路由鉴权清单（C11）：每个 API handler 靠什么保护，写成一份可核对的台账。
 *
 * 背景两层，都不是猜的：
 *
 * 1. **`src/proxy.ts` 只保护页面。** 它的 `protectedRoutes` 是 `/dashboard` 与 `/dashboard/(.*)`，
 *    `/api/*` 一个都不在里面——每个 API handler 的鉴权完全在它自己（或它调用的 helper）身上，
 *    而页面级重定向很容易让人以为「API 也被挡住了」。
 * 2. 这个形态真的红过一次：`api/e2e/email-inbox` 的 GET 在 2026-09-24 之前没有任何鉴权，
 *    而同文件的 POST/DELETE 有——收件箱里装的是「已发送」邮件原文（含确认 / 退订 token），
 *    一次 GET 还会顺手改写服务器的注入标志位。当时没有任何门禁发现少了一个守卫，
 *    因为没有任何地方记录着「这条路由本来该有什么」。
 *
 * 所以本模块不发明「什么算安全」的判据，只做两件可机械核对的事：
 *   - **每个 handler 必须有且只有一条台账**（新加一条没登记的路由直接红）；
 *   - **台账声明的守卫符号必须真的能从该 handler 走到**（把 `requireAuth` 删掉、
 *     或者把它换成一个不相干的调用，也红）。
 * `reason` 那一段是人写的判断，本模块强制的是它存在、并且与 reachable 的符号同一家族。
 *
 * 解析形态刻意收窄：只认 `src/app/api/**` 下 `export async function GET|POST|PUT|PATCH|DELETE`
 * （本仓库全部路由都是这个写法），一条 handler 都没解析出来时失败封闭。
 */

import ts from "typescript";

/** 一份源码：`file` 是仓库相对 POSIX 路径。 */
export interface RouteAuthSource {
  file: string;
  text: string;
}

/** 一个 handler 的解析结果。 */
export interface RouteHandlerFact {
  /** 台账主键，形如 `POST /api/uploads/avatar`。 */
  id: string;
  method: string;
  /** 由目录推出的路由路径，形如 `/api/uploads/avatar`。 */
  route: string;
  /** 所在文件，报错时指位置。 */
  file: string;
  /** 从 handler 出发（含同文件与跨文件 helper 展开）看得见的守卫符号，已排序去重。 */
  reachable: string[];
  /** 展开到深度上限时放弃的调用名数量，用于暴露「范围被调空」而不是只报 0 命中。 */
  truncated: number;
}

/** 保护家族。`public` 之外的一切都要由 `via` 里的符号兑现。 */
export type ProtectionFamily =
  | "session"
  | "origin"
  | "signature"
  | "shared-secret"
  | "mock-only"
  | "token"
  | "public";

/** 台账条目：这个端点靠什么保护，以及为什么这样是成立的。 */
export interface RouteAuthEntry {
  family: ProtectionFamily;
  /** 必须真的能从该 handler 走到的符号；`public` 可以为空。 */
  via: readonly string[];
  /** 人写的判断。理由为空一律红：没有理由的 `public` 只是一张「先这样吧」的条子。 */
  reason: string;
}

export interface RouteAuthIssue {
  code:
    | "ROUTE_AUTH_NO_HANDLERS"
    | "ROUTE_AUTH_UNLEDGED"
    | "ROUTE_AUTH_STALE"
    | "ROUTE_AUTH_GUARD_MISSING"
    | "ROUTE_AUTH_REASON_MISSING"
    | "ROUTE_AUTH_FAMILY_MISMATCH";
  subject: string;
  message: string;
}

/**
 * 守卫词表：符号 → 它所属的保护家族。解析器用它决定「看到什么就算有守卫」，
 * 台账用它做家族一致性检查。新加一个守卫就在这一行里加一条，
 * 于是「新守卫没人认领」会显形在这里，而不是散落在各条 reason 的文字里。
 */
export const PROTECTION_SYMBOLS: Readonly<Record<string, ProtectionFamily>> = {
  // 会话 / 角色 / 权限
  requireAuth: "session",
  requireRole: "session",
  requirePermission: "session",
  safelyRequireAuth: "session",
  safelyRequireRole: "session",
  safelyRequirePermission: "session",
  readSessionRole: "session",
  getUser: "session",
  getSession: "session",
  // 请求来源与上传边界
  sameOrigin: "origin",
  guardUploadRequest: "origin",
  // 第三方签名
  constructEvent: "signature",
  verifyWebhookSignature: "signature",
  // 共享密钥（cron / 运维端点，以及 e2e 收件箱的 bearer 比对）
  CRON_SECRET: "shared-secret",
  authOk: "shared-secret",
  // Mock 面：非 mock 构型下直接 404
  isMockEnabled: "mock-only",
  // 一次性 token（邮件里的确认 / 退订链接）：凭 URL 里的不可猜测 token，不靠会话
  confirmSubscription: "token",
  unsubscribeByToken: "token",
};

/** 调用图展开深度上限；超出的部分计入 `truncated` 而不是静默丢掉。 */
export const MAX_CALL_DEPTH = 5;

const HANDLER_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const API_DIR = "src/app/api/";

function issue(
  code: RouteAuthIssue["code"],
  subject: string,
  message: string,
): RouteAuthIssue {
  return { code, subject, message };
}

function toPosix(value: string): string {
  return value.split("\\").join("/");
}

/** `@/lib/x` → `src/lib/x`；相对路径按 POSIX 归一；其余（node / npm 包）返回 null。 */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (specifier.startsWith("@/")) return `src/${specifier.slice(2)}`;
  if (!specifier.startsWith(".")) return null;
  const segments = fromFile.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return segments.join("/");
}

interface ModuleFacts {
  /** 该文件里所有顶层函数 / 常量声明。 */
  declarations: Map<string, ts.Node>;
  /** 局部名 → 来源文件（不含后缀）。 */
  imports: Map<string, string>;
  source: ts.SourceFile;
}

function walk(node: ts.Node, visit: (current: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

/**
 * 一个子树里出现的名字，按三种形态分开：
 *  - `calls`：被调用的函数名（含 `a.b()` 的 `b`）；
 *  - `props`：属性访问名（`process.env.CRON_SECRET` 的 `CRON_SECRET` 走这里）；
 *  - `bare`：其余标识符引用（`if (!isMockEnabled)` 的 `isMockEnabled` 走这里）。
 *
 * 分开是因为 `bare` 最容易误认：一个恰好叫 `getUser` 的局部变量不该算守卫。所以判定
 * 守卫时，`bare` 只有在该名字确实是本文件的顶层声明或 import 进来的时候才算数。
 */
function referencedNames(node: ts.Node): { calls: Set<string>; props: Set<string>; bare: Set<string> } {
  const calls = new Set<string>();
  const props = new Set<string>();
  const bare = new Set<string>();
  walk(node, (current) => {
    if (ts.isCallExpression(current)) {
      const callee = current.expression;
      if (ts.isIdentifier(callee)) calls.add(callee.text);
      else if (ts.isPropertyAccessExpression(callee)) props.add(callee.name.text);
      return;
    }
    if (ts.isPropertyAccessExpression(current)) {
      props.add(current.name.text);
      return;
    }
    if (ts.isIdentifier(current)) bare.add(current.text);
  });
  return { calls, props, bare };
}

const suffixes = [".ts", ".tsx", "/index.ts", "/index.tsx"];

/** 一个源文件里的顶层可引用名字（函数、const/let、class）。 */
function topLevelDeclarations(source: ts.SourceFile): Map<string, ts.Node> {
  const declarations = new Map<string, ts.Node>();
  for (const statement of source.statements) {
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
      declarations.set(statement.name.text, statement);
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, declaration);
    }
  }
  return declarations;
}

/** 把源码集合变成可查询的模块事实。 */
function buildModules(sources: readonly RouteAuthSource[]): Map<string, ModuleFacts> {
  const modules = new Map<string, ModuleFacts>();
  for (const item of sources) {
    const file = toPosix(item.file);
    const source = ts.createSourceFile(file, item.text, ts.ScriptTarget.Latest, true);
    modules.set(file, {
      declarations: topLevelDeclarations(source),
      imports: new Map(),
      source,
    });
  }

  // import 映射要等所有模块登记完才能算（specifier 是路径，不是名字）
  for (const [file, facts] of modules) {
    walk(facts.source, (node) => {
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return;
      const base = resolveSpecifier(file, node.moduleSpecifier.text);
      if (base === null) return;
      const target = suffixes.map((suffix) => `${base}${suffix}`).find((candidate) => modules.has(candidate));
      if (!target) return;
      const clause = node.importClause;
      if (!clause) return;
      if (clause.name) facts.imports.set(clause.name.text, target);
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) facts.imports.set(element.name.text, target);
      }
      if (bindings && ts.isNamespaceImport(bindings)) {
        // `import * as x from "…"`：整个模块都算，靠名字太宽，直接按目标模块的顶层声明并入
        facts.imports.set(bindings.name.text, target);
      }
    });
  }
  return modules;
}

function routeOf(file: string): string {
  return `/${toPosix(file).slice("src/app/".length).replace(/\/route\.tsx?$/, "")}`;
}

/** 只看自有键：`"toString" in obj` 会顺着原型链命中，把每个文件都判成有守卫。 */
function isProtectionSymbol(symbol: string): symbol is keyof typeof PROTECTION_SYMBOLS {
  return Object.prototype.hasOwnProperty.call(PROTECTION_SYMBOLS, symbol);
}

/** 一个子树里看得见的守卫符号：函数名 / 属性名直接算，裸标识符要求它真是 import 或顶层声明。 */
function guardsIn(
  names: { calls: Set<string>; props: Set<string>; bare: Set<string> },
  owner: ModuleFacts,
): string[] {
  const hits: string[] = [];
  for (const symbol of [...names.calls, ...names.props]) {
    if (isProtectionSymbol(symbol)) hits.push(symbol);
  }
  for (const symbol of names.bare) {
    if (isProtectionSymbol(symbol) && (owner.declarations.has(symbol) || owner.imports.has(symbol))) {
      hits.push(symbol);
    }
  }
  return hits;
}

/** 某个名字能否作为下一步展开：本文件的顶层声明，或 import 进来的同名声明。 */
function nextTarget(
  modules: Map<string, ModuleFacts>,
  file: string,
  symbol: string,
): { node: ts.Node; file: string } | null {
  const owner = modules.get(file);
  if (!owner) return null;
  const own = owner.declarations.get(symbol);
  if (own) return { node: own, file };
  const from = owner.imports.get(symbol);
  const imported = from ? modules.get(from)?.declarations.get(symbol) : undefined;
  return imported && from ? { node: imported, file: from } : null;
}

/**
 * 从 handler 体出发做广度展开，收集调用图里可见的守卫符号。
 *
 * 环靠 `visited` 断掉；展开到 `maxDepth` 之外被放弃的次数计入 `truncated`，
 * 于是「上限太浅」是一个能打印、能被测试的数字，而不是静默的少报。
 */
function expandGuards(
  modules: Map<string, ModuleFacts>,
  file: string,
  body: ts.Node,
  maxDepth: number,
): { reachable: Set<string>; truncated: number } {
  const reachable = new Set<string>();
  let truncated = 0;
  const visited = new Set<string>();
  const queue: Array<{ node: ts.Node; file: string; depth: number }> = [{ node: body, file, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const owner = modules.get(current.file);
    if (!owner) continue;
    const names = referencedNames(current.node);
    for (const symbol of guardsIn(names, owner)) reachable.add(symbol);

    for (const symbol of new Set([...names.calls, ...names.props, ...names.bare])) {
      const key = `${current.file}#${symbol}`;
      if (visited.has(key)) continue;
      const target = nextTarget(modules, current.file, symbol);
      if (!target) continue;
      if (current.depth >= maxDepth) {
        truncated += 1;
        continue;
      }
      visited.add(key);
      queue.push({ node: target.node, file: target.file, depth: current.depth + 1 });
    }
  }
  return { reachable, truncated };
}

/**
 * 从全部源码里解析出每个 API handler 及其可达守卫符号。
 *
 * `sources` 需要包含 `src/app/api/**` 下的路由文件，以及它们（直接或间接）import 的
 * `src/**` 模块——只给路由文件会得到一批假的「无守卫」结论，`e2e/*` 的局部 `authOk`
 * 与上传端点的 `guardUploadRequest` 都是这种情况。
 *
 * `maxDepth` 默认就是导出常量；单测用更大的值复算一遍，用来证明「深度上限没有藏住守卫」。
 */
export function collectRouteHandlers(
  sources: readonly RouteAuthSource[],
  maxDepth: number = MAX_CALL_DEPTH,
): RouteHandlerFact[] {
  const modules = buildModules(sources);
  const handlers: RouteHandlerFact[] = [];

  for (const [file, facts] of modules) {
    if (!file.startsWith(API_DIR) || !/\/route\.tsx?$/.test(file)) continue;
    for (const [name, declaration] of facts.declarations) {
      if (!HANDLER_METHODS.has(name) || !ts.isFunctionDeclaration(declaration) || !declaration.body) continue;
      const modifiers = ts.getModifiers(declaration) ?? [];
      if (!modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;

      const { reachable, truncated } = expandGuards(modules, file, declaration.body, maxDepth);

      handlers.push({
        id: `${name} ${routeOf(file)}`,
        method: name,
        route: routeOf(file),
        file,
        reachable: [...reachable].sort(),
        truncated,
      });
    }
  }

  return handlers.sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * 台账本体。key 与 `collectRouteHandlers` 产出的 `id` 一一对应。
 *
 * 每条的 `reason` 都是 2026-09-24 逐条读源码写的；改守卫的人必须同时改这一行，
 * 这正是本门禁唯一强制得到的东西。`via` 里的符号都要能从该 handler 走到，
 * 所以「删掉守卫但留着台账」会直接红，而不是悄悄绿过去。
 */
export const ROUTE_AUTH_LEDGER: Readonly<Record<string, RouteAuthEntry>> = {
  // —— 会话 / 角色 / 权限 ——
  "GET /api/analytics": {
    family: "session",
    via: ["safelyRequireAuth"],
    reason: "读的是当前用户自己的埋点聚合；守卫失败（包括读不到会话的那种故障）答 401，不会退化成匿名空态",
  },
  "POST /api/stripe/checkout": {
    family: "session",
    via: ["safelyRequireAuth"],
    reason: "结账要 userId，匿名没有可计费的主体；此外还有 priceId 白名单（不认识的 price 直接 400，不是越权入口）",
  },
  "GET /api/invitations": {
    family: "session",
    via: ["safelyRequirePermission", "safelyRequireAuth"],
    reason: "列出团队的邀请需要 team 维度的权限，不是「登录了就能看」",
  },
  "POST /api/invitations": {
    family: "session",
    via: ["safelyRequirePermission", "safelyRequireAuth"],
    reason: "发邀请会改变团队成员，按权限判定；失败封闭（读不到角色就不发）",
  },
  "DELETE /api/invitations": {
    family: "session",
    via: ["safelyRequirePermission", "safelyRequireAuth"],
    reason: "撤回邀请同样要 team 权限，且只作用于本团队的待处理记录",
  },
  "GET /api/user": {
    family: "session",
    via: ["getUser"],
    reason: "只回读当前会话自己的身份；无会话即 401",
  },
  "PATCH /api/user": {
    family: "session",
    via: ["getUser"],
    reason: "改的是 auth.uid 自己那一行，写入范围由会话决定而非入参",
  },
  "DELETE /api/user": {
    family: "session",
    via: ["getUser"],
    reason:
      "会话本人的 id 才能进；`deleteAccountWithData` 头部写明「调用方负责确认请求来自本人」，" +
      "它自己做数据擦除后用 service-role 客户端 `auth.admin.deleteUser(userId)` 删号，删除失败即抛错（不静默成功）",
  },
  "POST /api/auth/passkey/register-options": {
    family: "session",
    via: ["getUser"],
    reason: "注册凭据必须是已登录用户；challenge 通过 httpOnly cookie 绑定到这一次请求",
  },
  "POST /api/auth/passkey/register-verify": {
    family: "session",
    via: ["getUser"],
    reason: "写凭据到别人账户是提权，所以 verify 仍然重新读会话，不信任 options 那一步的结果",
  },
  "POST /api/uploads/avatar": {
    family: "session",
    via: ["getUser", "guardUploadRequest"],
    reason:
      "三层：会话（上传目标 = auth.uid）、同源 + 限流 + 体积（guardUploadRequest），" +
      "以及 Storage RLS（024 的 insert 只授给 authenticated 且路径首段必须等于 auth.uid()）",
  },
  "POST /api/uploads/project-cover": {
    family: "session",
    via: ["getUser", "guardUploadRequest"],
    reason:
      "同头像的三层，另外在 service 里还要 `team_members` 的 owner/admin 成员检查（不是成员就 fail(\"onlyAdminsCreateProject\")），" +
      "所以「有会话」不等于「能改任意项目的封面」",
  },

  // // —— 共享密钥：调度器与运维端点 ——
  "POST /api/cron/digest": {
    family: "shared-secret",
    via: ["CRON_SECRET"],
    reason: "由外部 cron 触发，比对 Authorization: Bearer $CRON_SECRET；缺密钥即 401，不执行任何发送",
  },
  "POST /api/cron/retention": {
    family: "shared-secret",
    via: ["CRON_SECRET"],
    reason: "保留期清理会真删数据，所以只有持密钥的调度器能触发",
  },
  "POST /api/cron/push-retry": {
    family: "shared-secret",
    via: ["CRON_SECRET", "isMockEnabled"],
    reason: "同一个 handle 同时管 GET/POST：先比 bearer，再在 mock 构型下允许无密钥（本地/E2E 用）",
  },
  "GET /api/cron/push-retry": {
    family: "shared-secret",
    via: ["CRON_SECRET", "isMockEnabled"],
    reason: "与 POST 共用 handle，触发同一份重投逻辑，因此同级；不存在「GET 只读所以免鉴权」",
  },
  "GET /api/ops/supabase-restore": {
    family: "shared-secret",
    via: ["CRON_SECRET"],
    reason: "回读的是项目运维状态（连接、恢复点位），属运维面而非公开健康检查",
  },

  // —— 第三方签名 ——
  "POST /api/webhooks/stripe": {
    family: "signature",
    via: ["constructEvent"],
    reason: "用 stripe-signature 对原始 body 验签；验不过就 400，不进入任何状态迁移",
  },

  // —— 一次性 token（邮件链接）——
  "POST /api/marketing/confirm": {
    family: "token",
    via: ["confirmSubscription"],
    reason: "double opt-in 的确认动作以 URL 里的高熵 token 为凭据，命中才置 subscribed；token 无效即 404",
  },
  "POST /api/marketing/unsubscribe": {
    family: "token",
    via: ["unsubscribeByToken"],
    reason: "退订同理：凭 token 不凭会话（邮件客户端里根本没有会话），未命中 404",
  },

  // —— Mock 面：非 mock 构型下这些路由整体 404 ——
  "GET /api/e2e/contact-messages": {
    family: "mock-only",
    via: ["isMockEnabled"],
    reason: "只在 NEXT_PUBLIC_MOCK_ENABLED 下存在，生产构建里第一句就 404；数据是进程内假库",
  },
  "POST /api/e2e/contact-messages": {
    family: "mock-only",
    via: ["isMockEnabled"],
    reason: "同上：写的是内存假库，不触达任何真实存储",
  },
  "DELETE /api/e2e/contact-messages": {
    family: "mock-only",
    via: ["isMockEnabled"],
    reason: "同上，清空的是进程内假库",
  },
  "GET /api/e2e/email-worker-runs": {
    family: "mock-only",
    via: ["isMockEnabled"],
    reason: "E2E 断言 worker 运行记录用；生产 404",
  },
  "GET /api/e2e/email-inbox": {
    family: "shared-secret",
    via: ["authOk", "isMockEnabled"],
    reason:
      "收件箱里是「已发送」邮件原文（含确认 / 退订 token），读取本身就是敏感操作，" +
      "所以与同文件 POST/DELETE 同级：mock 构型 + Bearer 双条件。2026-09-24 之前 GET 漏了 bearer",
  },
  "POST /api/e2e/email-inbox": {
    family: "shared-secret",
    via: ["authOk", "isMockEnabled"],
    reason: "注入一封假邮件会改变后续断言，需要 bearer",
  },
  "DELETE /api/e2e/email-inbox": {
    family: "shared-secret",
    via: ["authOk", "isMockEnabled"],
    reason: "清空收件箱，同样需要 bearer",
  },
  "POST /api/e2e/mock-reset": {
    family: "mock-only",
    via: ["isMockEnabled"],
    reason: "重置进程内假库；生产 404，本地测试夹具",
  },
  "GET /api/e2e/mock-upload": {
    family: "mock-only",
    via: ["isMockEnabled"],
    reason: "读 mock 存储桶里的对象元数据，仅测试构型存在",
  },
  "POST /api/e2e/mock-upload": {
    family: "mock-only",
    via: ["isMockEnabled"],
    reason: "往 mock 存储桶里塞对象，不落真实 Storage",
  },
  "GET /api/e2e/push-queue": {
    family: "mock-only",
    via: ["isMockEnabled"],
    reason: "读的是内存推送队列，测试夹具",
  },
  "POST /api/e2e/push-queue": {
    family: "mock-only",
    via: ["isMockEnabled"],
    reason: "注入队列条目，只在 mock 构型有意义",
  },
  "DELETE /api/e2e/push-queue": {
    family: "mock-only",
    via: ["isMockEnabled"],
    reason: "清空内存队列",
  },
  "GET /api/e2e/seed-notifications": {
    family: "mock-only",
    via: ["isMockEnabled"],
    reason: "读播种出来的通知，测试夹具",
  },
  "POST /api/e2e/seed-notifications": {
    family: "mock-only",
    via: ["isMockEnabled"],
    reason: "播种通知数据，只在 mock 构型下存在",
  },
  "DELETE /api/e2e/seed-notifications": {
    family: "mock-only",
    via: ["isMockEnabled"],
    reason: "清掉播种数据",
  },
  "GET /api/e2e/webhook-events": {
    family: "mock-only",
    via: ["isMockEnabled"],
    reason: "读假库里的 webhook 事件记录（幂等性断言用）",
  },
  "DELETE /api/e2e/webhook-events": {
    family: "mock-only",
    via: ["isMockEnabled"],
    reason: "清掉这些记录，同上",
  },

  // —— 公开：无守卫，且这是判断过的 ——
  "GET /api/health": {
    family: "public",
    via: [],
    reason: "存活探针，不含任何用户数据或内部拓扑；返回体是静态结构",
  },
  "GET /api/og": {
    family: "public",
    via: [],
    reason: "分享卡片图，本来就要给抓取方；文本来自站内固定的模板而非用户内容",
  },
  "GET /api/marketing/confirm": {
    family: "public",
    via: [],
    reason: "确认页只是渲染一个把 token 回传给 POST 的表单，GET 本身不改任何状态（token 会被转义）",
  },
  "GET /api/marketing/unsubscribe": {
    family: "public",
    via: [],
    reason: "退订页同上：非幂等的动作一律留在 POST",
  },
  "POST /api/auth/passkey/auth-options": {
    family: "public",
    via: [],
    reason:
      "passkey 登录的起点必须在建立会话之前，所以不可能有会话守卫；`allowCredentials: []` 因此不泄露" +
      "账号存在性，另有 feature flag 双门控与 10 次 / 分钟的限频",
  },
  "POST /api/auth/passkey/auth-verify": {
    family: "public",
    via: [],
    reason:
      "同上：这一支就是认证本身。凭据校验不过即 401，challenge 是一次性且绑定在 httpOnly cookie 上，" +
      "同样有 feature flag 与限频",
  },
  "GET /api/auth/callback": {
    family: "public",
    via: [],
    reason:
      "OAuth / 魔法链接回调，进来时本来就没有会话：换取会话用的是一次性的 code，" +
      "跳转目标过 getSafeRedirect 白名单，不反射任意 next",
  },
};

/** 必须写理由的家族：这些是「不靠会话」的端点，理由是唯一凭据。 */
const FAMILIES_REQUIRING_REASON: readonly ProtectionFamily[] = [
  "public",
  "token",
  "shared-secret",
  "mock-only",
  "signature",
  "origin",
];
/** 执行清单核对。`ledger` 可注入，便于单测覆盖每一种偏差形态。 */
/** 一个 handler 与其台账条目的全部一致性判定。 */
function auditLedgerEntry(handler: RouteHandlerFact, entry: RouteAuthEntry): RouteAuthIssue[] {
  const issues: RouteAuthIssue[] = [];
  if (FAMILIES_REQUIRING_REASON.includes(entry.family) && entry.reason.trim().length === 0) {
    issues.push(
      issue(
        "ROUTE_AUTH_REASON_MISSING",
        handler.id,
        `家族是 ${entry.family} 却没写 reason：这条公开 / 非会话端点凭什么算安全`,
      ),
    );
  }
  if (entry.family !== "public" && entry.via.length === 0) {
    issues.push(
      issue(
        "ROUTE_AUTH_GUARD_MISSING",
        handler.id,
        `家族是 ${entry.family} 却没有任何 via 符号；没有可核对的守卫就等于没有登记`,
      ),
    );
  }
  for (const symbol of entry.via) {
    if (!handler.reachable.includes(symbol)) {
      issues.push(
        issue(
          "ROUTE_AUTH_GUARD_MISSING",
          handler.id,
          `台账声明的守卫 \`${symbol}\` 在该 handler 的调用图里找不到（被删了、改名了，或挪到了别的分支上）`,
        ),
      );
    }
  }
  if (entry.via.length > 0) {
    const families = entry.via.filter(isProtectionSymbol).map((symbol) => PROTECTION_SYMBOLS[symbol]);
    if (!families.includes(entry.family)) {
      issues.push(
        issue(
          "ROUTE_AUTH_FAMILY_MISMATCH",
          handler.id,
          `家族写的是 ${entry.family}，但 via 里的符号属于 ${families.join("/") || "词表之外"}`,
        ),
      );
    }
  }
  return issues;
}

export function auditRouteAuth(
  handlers: readonly RouteHandlerFact[],
  ledger: Readonly<Record<string, RouteAuthEntry>> = ROUTE_AUTH_LEDGER,
): RouteAuthIssue[] {
  const issues: RouteAuthIssue[] = [];

  if (handlers.length === 0) {
    return [
      issue(
        "ROUTE_AUTH_NO_HANDLERS",
        API_DIR,
        "一个 API handler 都没解析出来：目录约定或解析器已经失效，不能报「一切正常」",
      ),
    ];
  }

  const seen = new Set<string>();
  for (const handler of handlers) {
    seen.add(handler.id);
    const entry = ledger[handler.id];
    if (!entry) {
      issues.push(
        issue(
          "ROUTE_AUTH_UNLEDGED",
          handler.id,
          `${handler.file} 的这个 handler 没有台账条目；在 ROUTE_AUTH_LEDGER 里登记家族、守卫符号与理由（无守卫就写 public 并把判断写清）`,
        ),
      );
      continue;
    }
    issues.push(...auditLedgerEntry(handler, entry));
  }

  for (const id of Object.keys(ledger).sort()) {
    if (seen.has(id)) continue;
    issues.push(
      issue(
        "ROUTE_AUTH_STALE",
        id,
        `台账里有 ${id}，代码里已经没有这个 handler 了——路由改名或删除时把条目一起清掉`,
      ),
    );
  }

  return issues;
}

/** 稳定输出，CLI 与单测共用。 */
export function formatRouteAuthIssues(issues: readonly RouteAuthIssue[]): string {
  return issues.map((item) => `[${item.code}] ${item.subject}: ${item.message}`).join("\n");
}
