/**
 * `src/lib/i18n/dynamic-keys.ts` 纯规则单测（D04 补集）。
 *
 * 重点是**证明门禁会失败**：`check:i18n` 按设计跳过动态 `t(\`...\`)`，
 * 这个盲区曾经让 mock 层生成的四种不存在的通知类型一路绿灯。
 */
import { describe, expect, it } from "vitest";
import {
  auditDynamicKeys,
  findDynamicTemplates,
  findStaticKeys,
  flattenLeafKeys,
  formatDynamicKeyIssues,
  type DiscoveredTemplate,
  type DynamicKeyContract,
} from "./dynamic-keys";

function contract(overrides: Partial<DynamicKeyContract> = {}): DynamicKeyContract {
  return {
    id: "demo",
    keyPrefix: "demo.things",
    values: ["alpha", "beta"],
    source: "@/lib/demo#THINGS",
    reason: "示例",
    ...overrides,
  };
}

function leaves(locale: string, keys: string[]): [string, ReadonlySet<string>][] {
  return [[locale, new Set(keys)]];
}

function codesOf(input: Parameters<typeof auditDynamicKeys>[0]) {
  return auditDynamicKeys(input).issues.map((issue) => issue.code);
}

describe("flattenLeafKeys", () => {
  it("嵌套对象按点号展开，数组按索引展开", () => {
    expect(
      flattenLeafKeys({ ns: { a: { b: "x" }, list: ["y", { c: "z" }] } }).sort(),
    ).toEqual(["ns.a.b", "ns.list.0", "ns.list.1.c"]);
  });

  it("带前缀调用时前缀成为路径第一段（消息文件即命名空间）", () => {
    expect(flattenLeafKeys({ deep: { link: 1 } }, "dashboard")).toEqual(["dashboard.deep.link"]);
  });

  it("标量根节点返回前缀本身", () => {
    expect(flattenLeafKeys("x", "k")).toEqual(["k"]);
    expect(flattenLeafKeys({})).toEqual([]);
  });
});

describe("findDynamicTemplates", () => {
  it("识别 useTranslations / await getTranslations 命名空间下的动态模板", () => {
    const files = [
      {
        path: "src/app/x/page.tsx",
        content:
          'const t = useTranslations("dashboard");\n' +
          "const tc = await getTranslations(\"common\");\n" +
          "return t(`notifications.list.types.${type}`);\n",
      },
    ];
    expect(findDynamicTemplates(files)).toEqual([
      {
        file: "src/app/x/page.tsx",
        line: 3,
        keyPrefix: "dashboard.notifications.list.types",
        template: "notifications.list.types.${type}",
      },
    ]);
  });

  it("t.has(`...`) 也算动态模板（守卫不替代翻译）", () => {
    const files = [
      {
        path: "a.tsx",
        content: 'const t = useTranslations("dashboard");\nconst ok = t.has(`view.roles.${r}`);\n',
      },
    ];
    expect(findDynamicTemplates(files)[0].keyPrefix).toBe("dashboard.view.roles");
  });

  it("非翻译变量的模板字面量不算：redirect / import / trackEvent", () => {
    const files = [
      {
        path: "b.ts",
        content:
          "const url = `${origin}/auth/login`;\n" +
          "return NextResponse.redirect(`${origin}/x`);\n" +
          "await import(`../../messages/${locale}/${ns}.json`);\n" +
          'trackEvent(`error.${name}`, {});\n',
      },
    ];
    expect(findDynamicTemplates(files)).toEqual([]);
  });

  it("没有插值的模板字面量交给 check:i18n", () => {
    const files = [{ path: "c.tsx", content: 'const t = useTranslations("x");\nt(`a.b`);\n' }];
    expect(findDynamicTemplates(files)).toEqual([]);
  });

  it("未调用 useTranslations 的文件里的 t(`...`) 不算（避免同名变量误伤）", () => {
    expect(
      findDynamicTemplates([{ path: "d.tsx", content: "const t = other();\nt(`a.${b}`);\n" }]),
    ).toEqual([]);
  });
});

describe("findStaticKeys", () => {
  it("收集静态字面量引用，用于放行同前缀的兄弟键", () => {
    const keys = findStaticKeys([
      {
        path: "e.tsx",
        content:
          'const t = useTranslations("common");\nreturn <>{t("shortcuts.title")}{t.has("a.b")}</>;\n',
      },
    ]);
    expect([...keys].sort()).toEqual(["common.a.b", "common.shortcuts.title"]);
  });
});

describe("auditDynamicKeys：每条规则都必须能失败", () => {
  const templates = (keyPrefix: string): DiscoveredTemplate[] => [
    { file: "f.tsx", line: 1, keyPrefix, template: "x" },
  ];

  it("取值齐全 → 通过，并给出计数器", () => {
    const report = auditDynamicKeys({
      contracts: [contract()],
      leafKeysByLocale: Object.fromEntries(
        leaves("en", ["demo.things.alpha", "demo.things.beta"]).concat(
          leaves("zh-CN", ["demo.things.alpha", "demo.things.beta"]),
        ),
      ),
      templates: templates("demo.things"),
    });
    expect(report.issues).toEqual([]);
    expect(report.stats).toEqual({ contracts: 1, locales: 2, values: 2, templates: 1 });
  });

  it("某个 locale 缺一个键 → DYNAMIC_KEY_MISSING", () => {
    expect(
      codesOf({
        contracts: [contract()],
        leafKeysByLocale: {
          en: new Set(["demo.things.alpha", "demo.things.beta"]),
          "zh-CN": new Set(["demo.things.alpha"]),
        },
      }),
    ).toEqual(["DYNAMIC_KEY_MISSING"]);
  });

  it("前缀下出现集合之外的键 → DYNAMIC_KEY_ORPHAN", () => {
    expect(
      codesOf({
        contracts: [contract()],
        leafKeysByLocale: {
          en: new Set(["demo.things.alpha", "demo.things.beta", "demo.things.gamma"]),
        },
      }),
    ).toEqual(["DYNAMIC_KEY_ORPHAN"]);
  });

  it("同前缀的静态兄弟键不算孤儿（common.shortcuts.desc 这类）", () => {
    expect(
      codesOf({
        contracts: [contract({ values: ["commandPalette"] })],
        leafKeysByLocale: {
          en: new Set(["demo.things.commandPalette", "demo.things.desc", "demo.things.title"]),
        },
        staticKeys: new Set(["demo.things.desc", "demo.things.title"]),
      }),
    ).toEqual([]);
  });

  it("更深层的键不参与孤儿判定（只比直接子键）", () => {
    expect(
      codesOf({
        contracts: [contract()],
        leafKeysByLocale: {
          en: new Set(["demo.things.alpha", "demo.things.beta", "demo.things.x.y"]),
        },
      }),
    ).toEqual([]);
  });

  it("源码里有未登记的动态前缀 → DYNAMIC_KEY_UNREGISTERED_TEMPLATE", () => {
    expect(
      codesOf({
        contracts: [contract()],
        leafKeysByLocale: { en: new Set(["demo.things.alpha", "demo.things.beta"]) },
        templates: templates("demo.other"),
      }),
    ).toEqual(["DYNAMIC_KEY_UNREGISTERED_TEMPLATE"]);
  });

  it("一个 locale 都没读到 → 失败封闭，而不是空循环通过", () => {
    expect(codesOf({ contracts: [contract()], leafKeysByLocale: {} })).toEqual([
      "DYNAMIC_KEY_NO_LOCALES",
    ]);
  });

  it("契约集合为空 → 失败封闭", () => {
    expect(codesOf({ contracts: [], leafKeysByLocale: { en: new Set() } })).toEqual([
      "DYNAMIC_KEY_NO_CONTRACTS",
    ]);
  });

  it("某个契约取值为空 → DYNAMIC_KEY_EMPTY_VALUES，而不是静默通过", () => {
    expect(
      codesOf({
        contracts: [contract({ values: [] })],
        leafKeysByLocale: { en: new Set(["demo.things.alpha"]) },
      }),
    ).toEqual(["DYNAMIC_KEY_EMPTY_VALUES"]);
  });

  it("报错文案带出处与 locale，便于直接定位", () => {
    const report = auditDynamicKeys({
      contracts: [contract()],
      leafKeysByLocale: { en: new Set(["demo.things.alpha"]) },
    });
    const text = formatDynamicKeyIssues(report.issues);
    expect(text).toContain("[DYNAMIC_KEY_MISSING] en demo.things.beta");
    expect(text).toContain("@/lib/demo#THINGS");
  });
});
