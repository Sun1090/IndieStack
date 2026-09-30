import { describe, expect, it } from "vitest";
import {
  auditTranslationUsage,
  callPatternFor,
  collectNamespaceBindings,
  escapeForRegExp,
  formatTranslationUsageIssues,
  hasPath,
  lineOf,
  stripComments,
} from "./translation-usage.ts";

const MESSAGES = {
  en: { Common: { hello: "Hello", nested: { deep: "Deep" }, onlyEn: "only English" } },
  "zh-CN": { Common: { hello: "你好", nested: { deep: "深" } } },
};
const LOCALES = ["en", "zh-CN"];

describe("stripComments", () => {
  it("去掉行注释与块注释", () => {
    expect(stripComments('a; // t("x")\nb;')).toContain("a;");
    expect(stripComments('a; /* t("x") */ b;')).not.toContain('t("x")');
  });

  it("保留换行，行号不错位", () => {
    const stripped = stripComments('a;\n// 一\n// 二\nb;');
    expect(stripped.split("\n")).toHaveLength(4);
  });

  it("不把字符串里的 // 当注释（否则 t(\"a//b\") 会被截断）", () => {
    const source = 't("a//b");';
    expect(stripComments(source)).toBe(source);
  });

  it("不把字符串里的 /* 当注释", () => {
    const source = 'const s = "/* not a comment */";';
    expect(stripComments(source)).toBe(source);
  });

  it("模板字面量整体当字符串保留", () => {
    const source = "t(`a.${b}`);";
    expect(stripComments(source)).toBe(source);
  });
});

describe("escapeForRegExp", () => {
  it("转义正则元字符", () => {
    expect(escapeForRegExp("a.b*c")).toBe("a\\.b\\*c");
  });

  it("转义 $ —— 不转义会让含 $ 的别名永远匹配不到", () => {
    expect(escapeForRegExp("t$")).toBe("t\\$");
  });
});

describe("callPatternFor", () => {
  it("含 $ 的别名也能匹配到自己的调用（未转义时永远匹配不到）", () => {
    const source = 'const t$ = useTranslations("Common");\nt$("hello");';
    const pattern = callPatternFor("t$");
    const found = [...source.matchAll(pattern)].map((m) => m[2]);
    expect(found).toEqual(["hello"]);
  });

  it("含元字符的别名不会误匹配别的标识符", () => {
    const pattern = callPatternFor("t.x");
    expect([...'a t.x("k"); b tx("k");'.matchAll(pattern)]).toHaveLength(1);
  });
});

describe("lineOf", () => {
  it("下标所在行 1 起算", () => {
    expect(lineOf("a\nb\nc", 0)).toBe(1);
    expect(lineOf("a\nb\nc", 2)).toBe(2);
    expect(lineOf("a\nb\nc", 4)).toBe(3);
  });
});

describe("hasPath", () => {
  it("命中顶层与嵌套 key", () => {
    expect(hasPath(MESSAGES.en, "Common.hello")).toBe(true);
    expect(hasPath(MESSAGES.en, "Common.nested.deep")).toBe(true);
  });

  it("缺失、中间层不存在、以及把叶子当前缀都算缺失", () => {
    expect(hasPath(MESSAGES.en, "Common.nope")).toBe(false);
    expect(hasPath(MESSAGES.en, "Nope.hello")).toBe(false);
    expect(hasPath(MESSAGES.en, "Common.hello.x")).toBe(false);
  });

  it("值为 null 算存在（key 在，只是值为 null）", () => {
    expect(hasPath({ A: { b: null } }, "A.b")).toBe(true);
  });
});

describe("collectNamespaceBindings", () => {
  it("抽出字面量命名空间绑定，含 await getTranslations", () => {
    const { bindings } = collectNamespaceBindings(
      'const t = useTranslations("Common");\nconst s = await getTranslations("Settings");',
    );
    expect(bindings).toEqual([
      { alias: "t", namespace: "Common" },
      { alias: "s", namespace: "Settings" },
    ]);
  });

  it("非字面量命名空间不绑定（跳过而不是猜）", () => {
    const { bindings } = collectNamespaceBindings("const t = useTranslations(ns);");
    expect(bindings).toEqual([]);
  });

  it("同一别名重复绑定同一命名空间不算冲突", () => {
    const { bindings, ambiguous } = collectNamespaceBindings(
      'const t = useTranslations("Common");\nconst t = getTranslations("Common");',
    );
    expect(ambiguous).toEqual([]);
    expect(bindings).toEqual([{ alias: "t", namespace: "Common" }]);
  });

  it("同一别名绑不同命名空间：报冲突，且不产出绑定（不挑一个继续）", () => {
    const { bindings, ambiguous } = collectNamespaceBindings(
      'const t = useTranslations("A");\nconst t = getTranslations("B");',
    );
    expect(ambiguous).toEqual([{ alias: "t", namespaces: ["A", "B"] }]);
    expect(bindings).toEqual([]);
  });
});

describe("auditTranslationUsage", () => {
  it("两边都有的 key 不报错", () => {
    const report = auditTranslationUsage({
      files: [{ path: "a.tsx", content: 'const t = useTranslations("Common");\nt("hello");' }],
      messages: MESSAGES,
      locales: LOCALES,
    });
    expect(report.errors).toEqual([]);
    expect(report.stats.scannedCalls).toBe(1);
  });

  it("缺一个 locale 的 key 就报，并点名 locale 与 key", () => {
    const report = auditTranslationUsage({
      files: [{ path: "a.tsx", content: 'const t = useTranslations("Common");\nt("onlyEn");' }],
      messages: MESSAGES,
      locales: LOCALES,
    });
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].code).toBe("MISSING_KEY");
    expect(report.errors[0].message).toContain("zh-CN");
    expect(report.errors[0].message).toContain("Common.onlyEn");
  });

  it("两个 locale 都缺就报两条", () => {
    const report = auditTranslationUsage({
      files: [{ path: "a.tsx", content: 'const t = useTranslations("Common");\nt("nope");' }],
      messages: MESSAGES,
      locales: LOCALES,
    });
    expect(report.errors).toHaveLength(2);
  });

  it("行号指向调用所在行", () => {
    const report = auditTranslationUsage({
      files: [
        {
          path: "a.tsx",
          content: 'const t = useTranslations("Common");\n\n\nt("nope");',
        },
      ],
      messages: MESSAGES,
      locales: ["zh-CN"],
    });
    expect(report.errors[0].line).toBe(4);
  });

  it("rich / raw / has 三种形态都算调用", () => {
    const report = auditTranslationUsage({
      files: [
        {
          path: "a.tsx",
          content: 'const t = useTranslations("Common");\nt.rich("nope1");\nt.raw("nope2");\nt.has("nope3");',
        },
      ],
      messages: MESSAGES,
      locales: ["en"],
    });
    expect(report.errors).toHaveLength(3);
  });

  it("动态 key 被跳过而不是伪造成已验证（不算调用、不报错）", () => {
    const report = auditTranslationUsage({
      files: [
        {
          path: "a.tsx",
          content: 'const t = useTranslations("Common");\nt(`roles.${role}`);\nt(dynamicKey);',
        },
      ],
      messages: MESSAGES,
      locales: LOCALES,
    });
    expect(report.errors).toEqual([]);
    expect(report.stats.scannedCalls).toBe(0);
  });

  it("别名遮蔽：报 AMBIGUOUS_NAMESPACE_ALIAS，而不是拿其中一个命名空间硬查", () => {
    const report = auditTranslationUsage({
      files: [
        {
          path: "a.tsx",
          content: 'const t = useTranslations("A");\nconst t = getTranslations("B");\nt("k");',
        },
      ],
      messages: MESSAGES,
      locales: LOCALES,
    });
    expect(report.errors.map((e) => e.code)).toEqual(["AMBIGUOUS_NAMESPACE_ALIAS"]);
    // 关键：不能顺手按 A 或 B 查一遍——那两种结果都是编的
    expect(report.stats.scannedCalls).toBe(0);
  });

  it("注释里的示例代码不算调用（这条门禁曾经因此报假红）", () => {
    const report = auditTranslationUsage({
      files: [
        {
          path: "a.tsx",
          content: [
            "// const t = useTranslations(\"A\"); t(\"nope\");",
            "/** const t = getTranslations(\"B\"); t(\"nope\"); */",
            'const t = useTranslations("Common");',
            't("hello");',
          ].join("\n"),
        },
      ],
      messages: MESSAGES,
      locales: LOCALES,
    });
    expect(report.errors).toEqual([]);
    expect(report.stats.scannedCalls).toBe(1);
  });

  it("文件里没有翻译调用时不报错", () => {
    const report = auditTranslationUsage({
      files: [{ path: "a.tsx", content: "export const x = 1;" }],
      messages: MESSAGES,
      locales: LOCALES,
    });
    expect(report.errors).toEqual([]);
  });
});

describe("formatTranslationUsageIssues", () => {
  it("逐条打印", () => {
    const report = auditTranslationUsage({
      files: [{ path: "a.tsx", content: 'const t = useTranslations("Common");\nt("nope");' }],
      messages: MESSAGES,
      locales: ["en"],
    });
    const text = formatTranslationUsageIssues(report.errors);
    expect(text).toContain("MISSING_KEY");
    expect(text).toContain("a.tsx:2");
  });

  it("没有问题时输出空字符串", () => {
    expect(formatTranslationUsageIssues([])).toBe("");
  });
});
