/**
 * `stripComments` 的用例（从 `src/lib/i18n/translation-usage.test.ts` 原样搬来，
 * 因为函数本体搬到了共享模块）。断言一条没改。
 */
import { describe, expect, it } from "vitest";
import { stripComments } from "./source-comments";

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

  it("注释被抹成长度相同的空白，不改变后续 token 的相对位置", () => {
    const source = "// abc\nx;";
    const stripped = stripComments(source);
    expect(stripped).toHaveLength(source.length);
    expect(stripped.endsWith("x;")).toBe(true);
  });
});
