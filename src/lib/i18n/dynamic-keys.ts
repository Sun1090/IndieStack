/**
 * 动态翻译键契约门禁（D04 的补集）。
 *
 * `check:i18n` 只扫静态 `t("字面量")`，动态模板 `t(\`notifications.list.types.${type}\`)` 按设计被跳过
 * ——这是文档里写明的盲区。盲区是有代价的：mock 数据层曾经生成 `info/success/warning/error` 四种
 * 通知类型，而真实的 `NOTIFICATION_TYPES` 是另外 7 个，于是开发/E2E 环境里每次渲染通知列表都在抛
 * `MISSING_MESSAGE`，并被页面里的 `try/catch` 静默退回成原始英文串——没有任何门禁会响。
 *
 * 本模块把「动态键」变成可审计的契约：
 *   1. 每个契约声明一个消息键前缀与它的**权威取值集合**（来自代码常量，不是手抄消息文件，
 *      否则门禁就成了同义反复、永远不会失败）；
 *   2. 每个取值必须在**每个 locale** 都有键，缺一个即 `DYNAMIC_KEY_MISSING`；
 *   3. 前缀下出现集合之外的键即 `DYNAMIC_KEY_ORPHAN`（要么枚举删了没清翻译，要么有人绕过枚举）；
 *   4. 源码里扫到的每个动态模板都必须有对应契约，否则 `DYNAMIC_KEY_UNREGISTERED_TEMPLATE`
 *      ——这条是防止本门禁退化成「只覆盖被登记的那几处」的关键；
 *   5. 契约集合为空、或某个契约的取值为空，直接失败封闭。
 */

export type DynamicKeyCode =
  | "DYNAMIC_KEY_MISSING"
  | "DYNAMIC_KEY_ORPHAN"
  | "DYNAMIC_KEY_EMPTY_VALUES"
  | "DYNAMIC_KEY_UNREGISTERED_TEMPLATE"
  | "DYNAMIC_KEY_NO_CONTRACTS"
  | "DYNAMIC_KEY_NO_LOCALES";

export interface DynamicKeyContract {
  /** 契约 id，出现在报错里。 */
  id: string;
  /** 完整消息路径前缀（含命名空间），如 `dashboard.notifications.list.types`。 */
  keyPrefix: string;
  /** 权威取值集合，必须来自代码常量。 */
  values: readonly string[];
  /** 取值集合的出处，便于报错时定位。 */
  source: string;
  /** 为什么这里非得用动态键——防止后人把它「顺手」改成静态而删掉契约。 */
  reason: string;
}

export interface DynamicKeyIssue {
  code: DynamicKeyCode;
  contractId: string;
  locale: string;
  key: string;
  message: string;
}

export interface DiscoveredTemplate {
  file: string;
  line: number;
  /** 完整前缀（含命名空间）。 */
  keyPrefix: string;
  /** 原始模板字面量内容。 */
  template: string;
}

export interface DynamicKeyAuditInput {
  contracts: readonly DynamicKeyContract[];
  /** locale → 已按 `<命名空间>.<路径>` 扁平化的叶子键集合。 */
  leafKeysByLocale: Record<string, ReadonlySet<string>>;
  /** 从源码扫出的动态模板（可选；IO 层会传入）。 */
  templates?: readonly DiscoveredTemplate[];
  /**
   * 源码里以**静态**字面量引用过的键（`t("shortcuts.title")` 之类）。
   * 同一个前缀下常常既有动态键又有静态兄弟键（`common.shortcuts.desc` / `.title` 是标题与说明，
   * 而 `commandPalette` 等才是动态项），孤儿判定必须放过它们，否则契约一登记就全是误报。
   */
  staticKeys?: ReadonlySet<string>;
}

export interface DynamicKeyReport {
  issues: DynamicKeyIssue[];
  stats: { contracts: number; locales: number; values: number; templates: number };
}

/** 把嵌套消息对象扁平成 `<prefix>.<path>` 叶子键集合。数组按索引展开，与翻译值审计一致。 */
export function flattenLeafKeys(node: unknown, prefix = ""): string[] {
  if (node === null || typeof node !== "object") return prefix ? [prefix] : [];
  if (Array.isArray(node)) {
    return node.flatMap((item, index) => flattenLeafKeys(item, prefix ? `${prefix}.${index}` : String(index)));
  }
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    flattenLeafKeys(value, prefix ? `${prefix}.${key}` : key),
  );
}

/**
 * 从源码里找出所有动态翻译模板。
 *
 * 只认「变量名出现在 `useTranslations` / `getTranslations` 赋值表里」的调用，
 * 这样 `redirect(\`${origin}/auth/login\`)`、`import(\`../../messages/${locale}\`)`、
 * `trackEvent(\`error.${name}\`)` 都不会被误当成翻译调用。
 */
export function findDynamicTemplates(
  files: readonly { path: string; content: string }[],
): DiscoveredTemplate[] {
  const found: DiscoveredTemplate[] = [];
  const nsDecl = /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:use|get)Translations\(\s*"([^"]+)"\s*\)/g;
  const callDecl = /(?:^|[^\w$.])(\w+)(?:\.has)?\(\s*`([^`]*)`\s*\)/g;
  for (const file of files) {
    const namespaces = new Map<string, string>();
    for (const match of file.content.matchAll(nsDecl)) namespaces.set(match[1], match[2]);
    if (namespaces.size === 0) continue;
    for (const match of file.content.matchAll(callDecl)) {
      const [whole, variable, template] = match;
      void whole;
      const namespace = namespaces.get(variable);
      if (!namespace) continue;
      const dollar = template.indexOf("${");
      if (dollar === -1) continue; // 无插值的模板字面量等价于静态键，交给 check:i18n
      const suffix = template.slice(0, dollar).replace(/\.$/, "");
      found.push({
        file: file.path,
        line: file.content.slice(0, match.index ?? 0).split("\n").length,
        keyPrefix: suffix ? `${namespace}.${suffix}` : namespace,
        template,
      });
    }
  }
  return found;
}

/**
 * 收集源码里以静态字面量引用的翻译键（`t("shortcuts.title")`、`t.has("a.b")`）。
 * 用于放行同一前缀下的静态兄弟键，避免契约把它们误判成孤儿。
 */
export function findStaticKeys(files: readonly { path: string; content: string }[]): Set<string> {
  const keys = new Set<string>();
  const nsDecl =
    /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:use|get)Translations\(\s*"([^"]+)"\s*\)/g;
  const callDecl = /(?:^|[^\w$.])(\w+)(?:\.has)?\(\s*"([^"]*)"\s*\)/g;
  for (const file of files) {
    const namespaces = new Map<string, string>();
    for (const match of file.content.matchAll(nsDecl)) namespaces.set(match[1], match[2]);
    if (namespaces.size === 0) continue;
    for (const match of file.content.matchAll(callDecl)) {
      const [, variable, key] = match;
      const namespace = namespaces.get(variable);
      if (!namespace || !key) continue;
      keys.add(`${namespace}.${key}`);
    }
  }
  return keys;
}

function issue(
  code: DynamicKeyCode,
  contractId: string,
  locale: string,
  key: string,
  message: string,
): DynamicKeyIssue {
  return { code, contractId, locale, key, message };
}

/** 单个契约的取值覆盖与孤儿键检查。 */
function auditContract(
  contract: DynamicKeyContract,
  locales: readonly string[],
  leafKeysByLocale: Record<string, ReadonlySet<string>>,
  staticKeys: ReadonlySet<string>,
): DynamicKeyIssue[] {
  const issues: DynamicKeyIssue[] = [];
  if (contract.values.length === 0) {
    issues.push(
      issue(
        "DYNAMIC_KEY_EMPTY_VALUES",
        contract.id,
        "-",
        contract.keyPrefix,
        `取值集合为空（权威来源 ${contract.source}），契约无法证明任何事`,
      ),
    );
    return issues;
  }
  const allowed = new Set(contract.values);
  const prefixDot = `${contract.keyPrefix}.`;
  for (const locale of locales) {
    const leaves = leafKeysByLocale[locale];
    for (const value of contract.values) {
      const key = `${prefixDot}${value}`;
      if (leaves.has(key)) continue;
      issues.push(
        issue(
          "DYNAMIC_KEY_MISSING",
          contract.id,
          locale,
          key,
          `取值 \`${value}\`（来自 ${contract.source}）在 ${locale} 里没有 \`${key}\`，` +
            "运行时只会显示原始英文枚举",
        ),
      );
    }
    for (const leaf of leaves) {
      if (!leaf.startsWith(prefixDot)) continue;
      const tail = leaf.slice(prefixDot.length);
      if (tail.includes(".") || allowed.has(tail) || staticKeys.has(leaf)) continue;
      issues.push(
        issue(
          "DYNAMIC_KEY_ORPHAN",
          contract.id,
          locale,
          leaf,
          `${locale} 里有 \`${leaf}\`，但它不在 ${contract.source} 的取值集合里（枚举已删或有人绕过枚举）`,
        ),
      );
    }
  }
  return issues;
}

/** 源码里出现、但登记表没有对应契约的动态前缀。 */
function auditTemplates(
  templates: readonly DiscoveredTemplate[],
  contracts: readonly DynamicKeyContract[],
): DynamicKeyIssue[] {
  const registered = new Set(contracts.map((contract) => contract.keyPrefix));
  const issues: DynamicKeyIssue[] = [];
  for (const template of templates) {
    if (registered.has(template.keyPrefix)) continue;
    issues.push(
      issue(
        "DYNAMIC_KEY_UNREGISTERED_TEMPLATE",
        "-",
        "-",
        template.keyPrefix,
        `${template.file}:${template.line} 用了动态键 \`${template.template}\`，但没有登记契约；` +
          "在 DYNAMIC_KEY_CONTRACTS 里补一条，声明它的权威取值集合",
      ),
    );
  }
  return issues;
}

/** 执行审计。 */
export function auditDynamicKeys(input: DynamicKeyAuditInput): DynamicKeyReport {
  const { contracts, leafKeysByLocale, templates = [], staticKeys = new Set<string>() } = input;
  const issues: DynamicKeyIssue[] = [];
  const locales = Object.keys(leafKeysByLocale);

  if (locales.length === 0) {
    // 消息目录没读到就零 locale，此时逐契约检查一次都不跑——门禁会安静地「全部通过」。
    issues.push(
      issue("DYNAMIC_KEY_NO_LOCALES", "-", "-", "-", "一个 locale 都没读到，消息目录或读取逻辑已失效"),
    );
  }

  if (contracts.length === 0) {
    issues.push(
      issue(
        "DYNAMIC_KEY_NO_CONTRACTS",
        "-",
        "-",
        "-",
        "一个动态键契约都没有，要么盲区又回来了，要么扫描范围失效",
      ),
    );
  }

  issues.push(...auditTemplates(templates, contracts));
  for (const contract of contracts) {
    issues.push(...auditContract(contract, locales, leafKeysByLocale, staticKeys));
  }

  return {
    issues,
    stats: {
      contracts: contracts.length,
      locales: locales.length,
      values: contracts.reduce((sum, contract) => sum + contract.values.length, 0),
      templates: templates.length,
    },
  };
}

/** 把问题渲染成逐行文本。 */
export function formatDynamicKeyIssues(issues: readonly DynamicKeyIssue[]): string {
  return issues.map((i) => `[${i.code}] ${i.locale} ${i.key} ${i.message}`).join("\n");
}
