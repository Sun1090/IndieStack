/**
 * 组件参考文档一致性门禁（D05）。
 *
 * 背景：`docs-site/components.md`（中英两半）与 `CLAUDE.md` 的组件地图都按「目录 → 组件」列
 * 清单并写出每个目录的数量。这类断言此前没有任何守卫，于是已经发生过四次静默腐化：
 *
 *   - `223f9eb` 删除 `page-loader.tsx` / `loading-state.tsx`，文档继续把 `PageLoader`、
 *     `LoadingState` 当成可用的 `shared/` 组件推荐；
 *   - `42de059` 删除 `search-input.tsx` / `page-container.tsx`，同样留在表里；
 *   - `DashboardSidebar` 早已搬去 `dashboard/`，参考文档仍写 `layout/`；
 *   - 五个目录的数量声明合计少报 25 个组件，其中 6 个 `ui/` 组件两侧文档都没列；
 *     `CLAUDE.md` 另有一处 provider 数量写 2，而 `SupabaseProvider` 在仓库里根本不存在。
 *
 * 对模板用户来说这不是措辞问题：照着文档 `import "@/components/shared/loading-state"` 会直接
 * 构建失败；而 `CLAUDE.md` 是 AI 助手读的第一份文件，它写错的组件名会被当成事实继续生成代码。
 * 所以本模块固化三条规则：
 *
 *   1. 文档表格里每一行组件都必须落到一个真实模块文件，且目录列与实际目录一致；
 *   2. 声明 `exhaustive` 的文档必须列全 `ENUMERATED_DIRECTORIES` 里的每个模块文件；
 *   3. 数量声明必须等于实测。两种写法都核：参考文档的目录树行（`├── ui/ … (30)`，允许写 0
 *      但不许不写），以及摘要文档的 `` `src/components/ui/` `` 表格行（散文里光提路径不报数字
 *      的不算断言）。
 *
 * 已知边界：只解析表格与上述两种数量写法。条目式清单（`CLAUDE.md` 的「共享组件」小节、
 * `agents/09-ui-ux.md` 的组件列表）不在解析范围内，靠人工——量过再决定不扩：那些清单没有统一的定位
 * 标记，又有逗号串与代码注释块两种形态，为它们各加一条宽松规则换来的假阳性比它们现在漏掉的错误更贵
 * （`| Schema | 文件 | 用途 |` 被读成一个叫 `Schema` 的组件，就是第一条宽松规则的结果）。
 * 表格只有第二格写成 `` `shared/` `` 这种纯目录形式时才核目录，写成 `` `shared/x.tsx` `` 文件路径的
 * （`docs/architecture/09`）只核名字存在，不核它挂在哪个目录。
 *
 * 只判断文档与代码是否一致，**不**比较中英文两半是否逐行对齐：两侧表格结构本就合法地不同
 * （英文 3 列、中文含示例段落），按行做镜像一致性会对着结构差异报警。
 *
 * 非枚举目录（`dashboard/`、`charts/`、`data-tables/`、`providers/`）的组件只用于解析名字与
 * 目录，不要求被列出，跳过数量在通过信息里报出来——收窄是有意的，收窄到零必须看得见。
 */

/** 文档承诺「列出全部组件」的目录；其余目录只解析、不要求被枚举。 */
export const ENUMERATED_DIRECTORIES = ["ui", "shared", "layout", "auth", "forms"] as const;

export interface ComponentDoc {
  /** 仓库相对路径，用于报错定位。 */
  file: string;
  /** 文档内容；读不到时传 null——失败封闭，不能把「没读到」当成「通过」。 */
  content: string | null;
  /**
   * `true`：文档承诺枚举所列目录的全部组件，缺一个就报 `COMPONENT_UNDOCUMENTED`
   * （`docs-site/components.md` 这种组件参考）。
   * `false`：只做「写到的必须真实、写出的数量必须对」，不要求穷举
   * （`CLAUDE.md` 的组件地图是给 AI 的摘要，逼它逐行同步只会得到一份没人维护的表）。
   */
  exhaustive: boolean;
}

export interface ComponentModule {
  /** `src/components/` 下的一级目录名。 */
  directory: string;
  /** 模块文件名，不含扩展名（`dropdown-menu`）。 */
  name: string;
}

export interface ComponentDocsInput {
  docs: readonly ComponentDoc[];
  modules: readonly ComponentModule[];
}

export type ComponentDocsIssueCode =
  | "COMPONENT_DOC_MISSING"
  | "COMPONENT_GHOST"
  | "COMPONENT_WRONG_DIRECTORY"
  | "COMPONENT_UNDOCUMENTED"
  | "COMPONENT_COUNT_STALE"
  | "COMPONENT_COUNT_MISSING"
  | "COMPONENT_NAME_AMBIGUOUS";

export interface ComponentDocsIssue {
  code: ComponentDocsIssueCode;
  message: string;
}

export interface ComponentDocsStats {
  docs: number;
  modules: number;
  enumeratedModules: number;
  rows: number;
  counts: number;
  skippedModules: number;
}

export interface ComponentDocsReport {
  issues: ComponentDocsIssue[];
  stats: ComponentDocsStats;
}

interface ComponentRow {
  file: string;
  line: number;
  name: string;
  /** 第二列写出的目录（`` `shared/` ``），`ui` 表没有这一列时为 null。 */
  directory: string | null;
}

/** PascalCase 组件名 → kebab 文件名；`DropdownMenu` → `dropdown-menu`。 */
export function moduleFileName(componentName: string): string {
  return componentName
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

/**
 * 解析 markdown 表格里的组件行：只有表头首格写着 `Component` / `组件` 的表才算组件表。
 * 不按「首格是 PascalCase」认表，是因为同一份文档里还有别的三列表格（比如 CLAUDE.md 的
 * `| Schema | 文件 | 用途 |`），把它们当组件表会得到一堆假幽灵。
 * 一行对应一个模块文件，而不是每个具名导出——`RadioGroupItem` 这种子导出应当并进父组件行。
 */
function parseRows(doc: ComponentDoc): ComponentRow[] {
  const rows: ComponentRow[] = [];
  const lines = (doc.content ?? "").split("\n");
  let inComponentTable = false;
  for (let index = 0; index < lines.length; index += 1) {
    const cells = lines[index].split("|").map((cell) => cell.trim());
    if (cells.length < 4) {
      inComponentTable = false;
      continue;
    }
    const heading = cells[1] === "Component" || cells[1] === "组件";
    if (heading) {
      inComponentTable = true;
      continue;
    }
    if (!inComponentTable) continue;
    const name = cells[1];
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) continue;
    rows.push({
      file: doc.file,
      line: index + 1,
      name,
      directory: /^`([a-z-]+)\/`$/.exec(cells[2])?.[1] ?? null,
    });
  }
  return rows;
}

/** 目录树里 `<dir>/` 开头的那一行（允许缩进与 `├──` 前缀）。 */
function treeLine(content: string, directory: string): string | undefined {
  const pattern = new RegExp(`^\\s*(?:[└├]─*\\s*)?${directory}/`);
  return content.split("\n").find((line) => pattern.test(line));
}

/**
 * 路径写法里的数量断言：每一个提到 `` `src/components/<dir>/` `` 且带数字的行都算一处
 * （散文里光提路径、不报数字的不算）。只取首行会被一句无意义的散文顶掉，所以逐行收集。
 */
function pathClaims(content: string, directory: string): Array<{ line: number; claimed: number }> {
  const claims: Array<{ line: number; claimed: number }> = [];
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes(`src/components/${directory}/`)) continue;
    const claimed = lastNumber(lines[index]);
    if (claimed !== null) claims.push({ line: index + 1, claimed });
  }
  return claims;
}

/** 取一行里最后一个整数——数量声明总是写在行的末尾。 */
function lastNumber(line: string): number | null {
  const matches = [...line.matchAll(/\d+/g)];
  return matches.length > 0 ? Number(matches[matches.length - 1][0]) : null;
}

/**
 * 数量断言检查：同一目录只看一种写法。目录树写法必须带数字（要么维护要么整行删掉，
 * 不许留一个「看着像索引、其实没人核」的空位）；路径写法允许只是提一下载体的散文。
 *
 * 目录树写法只在承诺枚举的参考文档里识别：`├── auth/` 这种一行目录在摘要文档里可能属于
 * `src/app` 路由树（CLAUDE.md 就是这么写的），只有 `` `src/components/auth/` `` 才是无歧义的。
 */
function auditCountClaims(
  doc: ComponentDoc,
  countsByDirectory: Map<string, number>,
): { checked: number; issues: ComponentDocsIssue[] } {
  const issues: ComponentDocsIssue[] = [];
  if (doc.content === null) return { checked: 0, issues };
  let checked = 0;
  for (const directory of ENUMERATED_DIRECTORIES) {
    const actual = countsByDirectory.get(directory) ?? 0;
    const tree = doc.exhaustive ? treeLine(doc.content, directory) : undefined;
    if (tree !== undefined) {
      const claimed = lastNumber(tree);
      if (claimed === null) {
        issues.push({
          code: "COMPONENT_COUNT_MISSING",
          message: `${doc.file} 的目录树写了 ${directory}/ 却没写数量：补上「${actual}」，或连目录行一起去掉`,
        });
        continue;
      }
      checked += 1;
      if (claimed !== actual) {
        issues.push({
          code: "COMPONENT_COUNT_STALE",
          message: `${doc.file} 声明 ${directory}/ 有 ${claimed} 个组件，实测 ${actual} 个`,
        });
      }
      continue;
    }
    for (const claim of pathClaims(doc.content, directory)) {
      checked += 1;
      if (claim.claimed === actual) continue;
      issues.push({
        code: "COMPONENT_COUNT_STALE",
        message:
          `${doc.file}:${claim.line} 声明 ${directory}/ 有 ${claim.claimed} 个组件，` +
          `实测 ${actual} 个`,
      });
    }
  }
  return { checked, issues };
}

/** 文档行与模块索引的比对：幽灵、目录写错、重名歧义。 */
function auditRows(
  rows: readonly ComponentRow[],
  modulesByName: Map<string, string[]>,
  issues: ComponentDocsIssue[],
): void {
  for (const row of rows) {
    const fileName = moduleFileName(row.name);
    const directories = modulesByName.get(fileName);
    if (!directories || directories.length === 0) {
      issues.push({
        code: "COMPONENT_GHOST",
        message:
          `${row.file}:${row.line} 列出了 ${row.name}（src/components/**/${fileName}.tsx），` +
          "但仓库里没有这个组件；删掉这一行，或把名字改成真实模块",
      });
      continue;
    }
    if (!row.directory) {
      if (directories.length > 1) {
        issues.push({
          code: "COMPONENT_NAME_AMBIGUOUS",
          message:
            `${row.file}:${row.line} 的 ${row.name} 同时存在于 ${directories.join("、")}，` +
            "无法判断表格指的是哪一个",
        });
      }
      continue;
    }
    if (directories.includes(row.directory)) continue;
    issues.push({
      code: "COMPONENT_WRONG_DIRECTORY",
      message:
        `${row.file}:${row.line} 把 ${row.name} 放在 \`${row.directory}/\`，` +
        `它实际在 \`${directories.join("、")}/\``,
    });
  }
}

/** 枚举目录里未被文档列出的模块。 */
function auditUndocumented(
  modules: readonly ComponentModule[],
  documentedFileNames: Set<string>,
  issues: ComponentDocsIssue[],
): void {
  for (const entry of modules) {
    if (documentedFileNames.has(entry.name)) continue;
    issues.push({
      code: "COMPONENT_UNDOCUMENTED",
      message:
        `src/components/${entry.directory}/${entry.name}.tsx 没有出现在组件参考里；` +
        "补一行，或把该目录移出 ENUMERATED_DIRECTORIES",
    });
  }
}

/** 审计组件参考文档与真实模块是否一致；纯函数，不读取文件系统。 */
export function auditComponentDocs(input: ComponentDocsInput): ComponentDocsReport {
  const issues: ComponentDocsIssue[] = [];

  const countsByDirectory = new Map<string, number>();
  const modulesByName = new Map<string, string[]>();
  for (const entry of input.modules) {
    countsByDirectory.set(entry.directory, (countsByDirectory.get(entry.directory) ?? 0) + 1);
    const known = modulesByName.get(entry.name);
    if (known) known.push(entry.directory);
    else modulesByName.set(entry.name, [entry.directory]);
  }

  const enumerated = input.modules.filter((module) =>
    (ENUMERATED_DIRECTORIES as readonly string[]).includes(module.directory),
  );
  const rows: ComponentRow[] = [];
  let counts = 0;

  for (const doc of input.docs) {
    if (doc.content === null) {
      issues.push({
        code: "COMPONENT_DOC_MISSING",
        message: `${doc.file} 读不到：这一半文档没有接受校验，不等于它通过了`,
      });
      continue;
    }
    const tree = auditCountClaims(doc, countsByDirectory);
    counts += tree.checked;
    issues.push(...tree.issues);
    const docRows = parseRows(doc);
    rows.push(...docRows);
    auditRows(docRows, modulesByName, issues);
    if (!doc.exhaustive) continue;
    auditUndocumented(
      enumerated,
      new Set(docRows.map((row) => moduleFileName(row.name))),
      issues,
    );
  }

  return {
    issues: issues.sort((left, right) => left.message.localeCompare(right.message)),
    stats: {
      docs: input.docs.length,
      modules: input.modules.length,
      enumeratedModules: enumerated.length,
      rows: rows.length,
      counts,
      skippedModules: input.modules.length - enumerated.length,
    },
  };
}

/** 格式化为带规则码的多行文本，供 CLI 与单测断言。 */
export function formatComponentDocIssues(issues: readonly ComponentDocsIssue[]): string {
  return issues.map((issue) => `❌ [${issue.code}] ${issue.message}`).join("\n");
}
