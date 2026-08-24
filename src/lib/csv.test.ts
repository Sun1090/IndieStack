/**
 * CSV 导出工具单元测试
 * 覆盖字段转义与公式注入防御（downloadCsv 依赖 DOM，node 环境不测）
 */
import { describe, it, expect } from "vitest";
import { toCsvString } from "./csv";

describe("toCsvString()", () => {
  it("空数组返回空字符串", () => {
    expect(toCsvString([])).toBe("");
  });

  it("输出表头与数据行", () => {
    expect(toCsvString([{ name: "Alice", age: 30 }])).toBe("name,age\nAlice,30");
  });

  it("多行数据逐行输出", () => {
    const csv = toCsvString([
      { a: 1, b: 2 },
      { a: 3, b: 4 },
    ]);
    expect(csv).toBe("a,b\n1,2\n3,4");
  });

  it("缺失字段补充为空字符串", () => {
    const csv = toCsvString([{ a: 1, b: 2 }, { a: 3 }]);
    expect(csv).toContain("3,");
  });

  it("转义包含逗号的字段", () => {
    expect(toCsvString([{ name: "Doe, John" }])).toBe('name\n"Doe, John"');
  });

  it("转义包含引号的字段（双引号翻倍）", () => {
    expect(toCsvString([{ note: 'say "hi"' }])).toBe('note\n"say ""hi"""');
  });

  it("转义包含换行符的字段", () => {
    expect(toCsvString([{ note: "line1\nline2" }])).toBe('note\n"line1\nline2"');
  });

  it("防御公式注入：= + - @ 前缀加单引号", () => {
    expect(toCsvString([{ v: "=SUM(A1:A2)" }])).toBe("v\n'=SUM(A1:A2)");
    expect(toCsvString([{ v: "+12345" }])).toBe("v\n'+12345");
    expect(toCsvString([{ v: "-1+2" }])).toBe("v\n'-1+2");
    expect(toCsvString([{ v: "@cmd" }])).toBe("v\n'@cmd");
  });

  it("公式注入防御忽略字段前导空白", () => {
    expect(toCsvString([{ v: "  =1+1" }])).toBe("v\n'  =1+1");
  });

  it("普通以字母开头的字段不受影响", () => {
    expect(toCsvString([{ v: "abc=123" }])).toBe("v\nabc=123");
  });
});

describe("公式注入变体防御", () => {
  it.each([
    ["\t=1+1"],
    ["\r=cmd"],
    [" \t+5"],
  ])("空白前缀变体 %j 仍被拦截", (payload) => {
    const csv = toCsvString([{ v: payload }]);
    expect(csv).toContain("'");
  });
});
