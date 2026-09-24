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

  it("裸 CR 也算行界：字段必须整体加引号", () => {
    // RFC 4180 要求字段内的 CR / LF / 引号都触发加引号，而这里此前只判 `\n`。
    // 后果不是「少一层引号」这种格式瑕疵：表格软件把裸 CR 当成一行的结束，
    // 于是一个字段在打开的表里变成两行——写入方那一格能凭空造出一行记录。
    expect(toCsvString([{ v: "a\rb" }])).toBe('v\n"a\rb"');
    expect(toCsvString([{ v: "one\rtwo\rthree" }])).toBe('v\n"one\rtwo\rthree"');
    // CRLF 里含 `\n`，本来就加引号；补一条钉住「两种换行都算」这件事。
    expect(toCsvString([{ v: "a\r\nb" }])).toBe('v\n"a\r\nb"');
  });

  it("公式注入前缀与裸 CR 同时出现时，两步处理都要留下痕迹", () => {
    // 先加 `'` 防注入，再因为含 CR 整体加引号——顺序反了会得到一个没引号的 CR。
    expect(toCsvString([{ v: "\r=cmd" }])).toBe('v\n"\'\r=cmd"');
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
