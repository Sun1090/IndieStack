/**
 * `pnpm check:states` 门禁行为单测（G04）
 * 保证规则模块与脚本能读真实仓库、排除上游基元/测试文件，并对四类回退写法返回退出码 1。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSnapshot, runStateCheck } from "../../../scripts/lib/state-check.js";
import {
  auditStates,
  formatStateIssues,
  LEGACY_LOADER_MODULES,
  PAGE_LOADING_MODULE,
  SPINNER_ALLOWLIST,
  type StateAuditFile,
  type StateRuleCode,
} from "./state-rules";

const tempDirs: string[] = [];

function writeTree(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "indiestack-states-"));
  tempDirs.push(dir);
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
  }
  return dir;
}

function repo(overrides: Record<string, string> = {}): string {
  return writeTree({
    "src/app/page.tsx": "export default function Page() {\n  return <div>ok</div>;\n}\n",
    ...overrides,
  });
}

function file(path: string, content: string): StateAuditFile {
  return { path, content };
}

function audit(sources: StateAuditFile[], routeLoading: StateAuditFile[] = []) {
  return auditStates({ sourceFiles: sources, routeLoadingFiles: routeLoading });
}

function codes(sources: StateAuditFile[], routeLoading: StateAuditFile[] = []): StateRuleCode[] {
  return audit(sources, routeLoading).errors.map((issue) => issue.code);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("auditStates()", () => {
  it("loading.tsx 渲染共享 PageLoading 时通过", () => {
    const routes = [
      file(
        "src/app/dashboard/loading.tsx",
        `import { PageLoading } from "${PAGE_LOADING_MODULE}";\n\nexport default function Loading() {\n  return <PageLoading variant="list" />;\n}\n`,
      ),
    ];
    expect(codes([...routes], routes)).toEqual([]);
  });

  it("loading.tsx 手写 Skeleton 报 RAW_ROUTE_SKELETON", () => {
    const routes = [
      file(
        "src/app/dashboard/loading.tsx",
        'import { Skeleton } from "@/components/ui/skeleton";\n\nexport default function Loading() {\n  return <Skeleton className="h-8" />;\n}\n',
      ),
    ];
    expect(codes(routes, routes)).toEqual(["RAW_ROUTE_SKELETON"]);
  });

  it("导入 PageLoading 但未渲染同样报错", () => {
    const routes = [
      file(
        "src/app/loading.tsx",
        `import { PageLoading } from "${PAGE_LOADING_MODULE}";\n\nexport default function Loading() {\n  return <div>loading</div>;\n}\n`,
      ),
    ];
    expect(codes(routes, routes)).toEqual(["RAW_ROUTE_SKELETON"]);
  });

  it("已删除的重复加载组件重新出现报 LEGACY_LOADER_MODULE", () => {
    for (const legacy of LEGACY_LOADER_MODULES) {
      expect(codes([file(legacy, "export const X = 1;\n")])).toEqual(["LEGACY_LOADER_MODULE"]);
    }
  });

  it("白名单外的 animate-spin 报 RAW_SPINNER，白名单文件除外", () => {
    const bad = file("src/app/auth/callback/page.tsx", '<div className="animate-spin" />;\n');
    expect(codes([bad])).toEqual(["RAW_SPINNER"]);
    for (const allowed of SPINNER_ALLOWLIST) {
      expect(codes([file(allowed, '<div className="animate-spin" />;\n')])).toEqual([]);
    }
  });

  it("裸占位符（text-center + py-N 同一类名）报 BARE_PLACEHOLDER 并给出行号", () => {
    const source = file(
      "src/app/dashboard/team/page.tsx",
      'export function X({ rows }: { rows: string[] }) {\n  return (\n    <div className="py-8 text-center text-muted-foreground">{rows.length}</div>\n  );\n}\n',
    );
    const report = audit([source]);
    expect(report.errors.map((issue) => issue.code)).toEqual(["BARE_PLACEHOLDER"]);
    expect(report.errors[0].line).toBe(3);
  });

  it("状态原语自身与分开书写的类名不算裸占位符", () => {
    expect(
      codes([
        file(
          "src/components/shared/empty-state.tsx",
          'const a = "flex flex-col py-10 text-center";\nconst b = "text-center";\nconst c = "py-10";\n',
        ),
        file(
          "src/components/dashboard/card.tsx",
          'const a = "text-center";\nconst b = "py-10";\nconst c = "h-32 text-center";\n',
        ),
      ]),
    ).toEqual([]);
  });

  it("统计扫描文件数与 loading.tsx 数", () => {
    const routes = [
      file("src/app/loading.tsx", "<PageLoading />\n"),
      file("src/app/dashboard/loading.tsx", "<PageLoading />\n"),
    ];
    const report = auditStates({
      sourceFiles: [...routes, file("src/app/page.tsx", "export default null;\n")],
      routeLoadingFiles: routes,
    });
    expect(report.stats).toEqual({ scannedFiles: 3, routeLoadingFiles: 2 });
  });

  it("格式化问题包含规则码、路径、行号与修复提示", () => {
    const text = formatStateIssues([
      {
        code: "BARE_PLACEHOLDER",
        file: "src/app/x.tsx",
        line: 9,
        message: "改用 EmptyState",
      },
    ]);
    expect(text).toContain("[BARE_PLACEHOLDER] src/app/x.tsx:9");
    expect(text).toContain("改用 EmptyState");
  });
});

describe("buildSnapshot()", () => {
  it("读取真实仓库：应用层文件非空，排除 ui 基元与测试文件", () => {
    const snapshot = buildSnapshot();
    expect(snapshot.sourceFiles.length).toBeGreaterThan(100);
    expect(
      snapshot.sourceFiles.some((entry: { path: string }) =>
        entry.path.startsWith("src/components/ui/"),
      ),
    ).toBe(false);
    expect(
      snapshot.sourceFiles.some((entry: { path: string }) => entry.path.endsWith(".test.tsx")),
    ).toBe(false);
  });

  it("收集所有路由 loading.tsx", () => {
    const snapshot = buildSnapshot();
    expect(snapshot.routeLoadingFiles.length).toBeGreaterThanOrEqual(12);
    expect(
      snapshot.routeLoadingFiles.every((entry: { path: string }) =>
        /loading\.tsx$/.test(entry.path),
      ),
    ).toBe(true);
    expect(
      snapshot.routeLoadingFiles.some(
        (entry: { path: string }) => entry.path === "src/app/loading.tsx",
      ),
    ).toBe(false);
  });
});

describe("runStateCheck()", () => {
  it("合规仓库返回 0 并打印扫描统计", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void logs.push(line));
    expect(runStateCheck(repo())).toBe(0);
    expect(logs.join("\n")).toContain("状态组件校验通过");
  });

  it("存在回退写法时返回 1 并打印规则码", () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => void errors.push(line));
    const dir = repo({
      "src/app/dashboard/loading.tsx":
        'export default function Loading() {\n  return <div className="animate-pulse" />;\n}\n',
    });
    expect(runStateCheck(dir)).toBe(1);
    expect(errors.join("\n")).toContain("RAW_ROUTE_SKELETON");
  });
});
