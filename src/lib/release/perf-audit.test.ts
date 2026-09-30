import { describe, expect, it } from "vitest";
import {
  CHART_MARKER,
  CSS_BUDGET_KB,
  auditPerf,
  formatPerfIssues,
  formatPerfSummary,
  resolveRef,
  type PerfArtifactFile,
} from "./perf-audit.ts";

function file(path: string, opts: { kb?: number; content?: string | null } = {}): PerfArtifactFile {
  const bytes = Math.round((opts.kb ?? 1) * 1024);
  return { path, bytes, content: opts.content === undefined ? `/* ${path} */` : opts.content };
}

/** 一棵「干净」的假产物树：图表在懒 chunk 里，落地页不含图表。 */
function cleanTree() {
  const files = [
    file("chunks/main.js", { kb: 30 }),
    file(`chunks/chart.js`, { kb: 360, content: `var a="${CHART_MARKER}";` }),
    file("chunks/style.css", { kb: 70 }),
  ];
  return { files, rootMainFiles: ["chunks/main.js", "chunks/style.css"] };
}

function run(input: Partial<Parameters<typeof auditPerf>[0]> = {}) {
  const base = cleanTree();
  const files = input.files ?? base.files;
  const known = new Set(files.map((f) => f.path));
  return auditPerf({
    files,
    rootMainFiles: input.rootMainFiles ?? base.rootMainFiles,
    exists: input.exists ?? ((candidate: string) => known.has(candidate)),
    cssBudgetKb: input.cssBudgetKb,
  });
}

describe("resolveRef", () => {
  it("同目录引用", () => {
    expect(resolveRef("chunks/a.js", "a.js.map")).toBe("chunks/a.js.map");
  });

  it("上跳引用", () => {
    expect(resolveRef("chunks/a.js", "../maps/a.js.map")).toBe("maps/a.js.map");
  });

  it("带 ./ 前缀", () => {
    expect(resolveRef("chunks/a.js", "./a.js.map")).toBe("chunks/a.js.map");
  });
});

describe("auditPerf — 干净时不报错", () => {
  it("三格全绿", () => {
    expect(run().errors).toEqual([]);
  });

  it("自述行把分母一起报出来", () => {
    const text = formatPerfSummary(auditPerf({
      files: cleanTree().files,
      rootMainFiles: cleanTree().rootMainFiles,
      exists: () => false,
    }));
    expect(text).toContain("1 个 chunk");
    expect(text).toContain("2 个文件，其中不含图表");
    expect(text).toContain("扫了 3 个产物文件");
  });
});

describe("auditPerf — 分母", () => {
  it("一条文件都没扫到时报红", () => {
    const report = auditPerf({ files: [], rootMainFiles: [], exists: () => false });
    expect(report.errors.map((e) => e.code)).toContain("NO_ARTIFACTS_SCANNED");
  });

  it("落地页初始 payload 未知时报红（懒加载这一格量不到东西）", () => {
    const report = auditPerf({
      files: cleanTree().files,
      rootMainFiles: [],
      exists: () => false,
    });
    expect(report.errors.map((e) => e.code)).toContain("LANDING_PAYLOAD_UNKNOWN");
  });
});

describe("auditPerf — 图表懒加载", () => {
  it("标记一处都找不到时报红（压缩器改名 ≠ 图表被删）", () => {
    const files = [file("chunks/main.js"), file("chunks/style.css")];
    const report = run({ files, rootMainFiles: ["chunks/main.js"] });
    expect(report.errors.map((e) => e.code)).toContain("CHART_MARKER_MISSING");
  });

  it("标记进了落地页初始 payload 就报红（懒加载回退）", () => {
    const files = [
      file("chunks/main.js", { content: `var a="${CHART_MARKER}";` }),
      file("chunks/style.css"),
    ];
    const report = run({ files, rootMainFiles: ["chunks/main.js"] });
    const issues = report.errors.filter((e) => e.code === "CHART_INLINED_IN_LANDING");
    expect(issues).toHaveLength(1);
    expect(issues[0].file).toBe("chunks/main.js");
  });

  it("读不出字节的文件（二进制）不算命中标记", () => {
    const files = [file("chunks/main.js", { content: null }), file("chunks/style.css")];
    const report = run({ files, rootMainFiles: ["chunks/main.js"] });
    expect(report.errors.map((e) => e.code)).toContain("CHART_MARKER_MISSING");
  });
});

describe("auditPerf — CSS 体积", () => {
  it("超过预算时报红", () => {
    const files = [...cleanTree().files, file("chunks/big.css", { kb: 40 })];
    const report = run({ files });
    expect(report.errors.map((e) => e.code)).toContain("CSS_BUDGET_EXCEEDED");
  });

  it("预算可注入，便于把阈值调低来验证它真的会响", () => {
    const report = run({ cssBudgetKb: 1 });
    expect(report.errors.map((e) => e.code)).toContain("CSS_BUDGET_EXCEEDED");
  });

  it("默认预算是 100kB", () => {
    expect(CSS_BUDGET_KB).toBe(100);
    const files = [file("chunks/a.css", { kb: 99.9 })];
    expect(run({ files, rootMainFiles: [] }).errors.map((e) => e.code)).not.toContain(
      "CSS_BUDGET_EXCEEDED",
    );
  });
});

describe("auditPerf — sourcemap 三形态", () => {
  it("独立的 .map 文件", () => {
    const files = [...cleanTree().files, file("chunks/a.js.map")];
    expect(run({ files }).errors.map((e) => e.code)).toContain("SOURCEMAP_FILE");
  });

  it("内联 data URI", () => {
    const files = [
      file("chunks/main.js", { content: "x\n//# sourceMappingURL=data:application/json;base64,e30=" }),
    ];
    const report = run({ files, rootMainFiles: ["chunks/main.js"] });
    expect(report.errors.map((e) => e.code)).toContain("SOURCEMAP_INLINE");
  });

  it("指向确实存在的 map", () => {
    const files = [
      file("chunks/main.js", { content: "//# sourceMappingURL=a.js.map" }),
      file("chunks/a.js.map"),
    ];
    const report = run({ files, rootMainFiles: ["chunks/main.js"] });
    const issues = report.errors.filter((e) => e.code === "SOURCEMAP_RESOLVABLE_REF");
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("a.js.map");
  });

  it("指向不存在路径的引用不算泄漏（假红防线）", () => {
    const files = [
      file("chunks/main.js", { content: "//# sourceMappingURL=does-not-exist.map" }),
      file(`chunks/chart.js`, { content: `var a="${CHART_MARKER}";` }),
    ];
    const report = run({ files, rootMainFiles: ["chunks/main.js"] });
    expect(report.errors).toEqual([]);
  });

  it("read 不到字节的文件不当成有标记", () => {
    const files = [file("font.woff2", { content: null }), file("chunks/main.js")];
    const report = run({ files, rootMainFiles: ["chunks/main.js"] });
    expect(report.errors.map((e) => e.code)).toEqual(["CHART_MARKER_MISSING"]);
  });
});

describe("formatPerfIssues", () => {
  it("逐条打印 code 与对象", () => {
    const report = run({ files: [file("chunks/main.js"), file("chunks/a.css")] });
    const text = formatPerfIssues(report.errors);
    expect(text).toContain("CHART_MARKER_MISSING");
    expect(text).toContain(".next/static");
  });

  it("没有问题时输出空字符串", () => {
    expect(formatPerfIssues([])).toBe("");
  });
});
