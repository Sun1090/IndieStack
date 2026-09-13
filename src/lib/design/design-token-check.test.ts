/**
 * `pnpm check:tokens` 门禁行为单测（G02）
 * 保证脚本能读真实仓库、排除上游基元目录与测试文件、按 errors 返回退出码 1。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSnapshot, runDesignTokenCheck } from "../../../scripts/lib/design-token-check.js";
import { DESIGN_TOKENS, type DesignToken } from "./tokens";

/** 生成结构自洽的 globals.css（注册表是单一事实源）。 */
function themeCss(tokens: DesignToken[] = DESIGN_TOKENS): string {
  const root = tokens.map((token) => `    --${token.name}: 0 0% 0%;`).join("\n");
  const dark = tokens
    .filter((token) => token.dark)
    .map((token) => `    --${token.name}: 0 0% 100%;`)
    .join("\n");
  const theme = tokens
    .filter((token) => token.utility)
    .map((token) => `  --color-${token.utilityName ?? token.name}: hsl(var(--${token.name}));`)
    .join("\n");
  return `@layer base {\n  :root {\n${root}\n  }\n  .dark {\n${dark}\n  }\n}\n\n@theme inline {\n${theme}\n}\n`;
}

const tempDirs: string[] = [];

function writeTree(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "indiestack-tokens-"));
  tempDirs.push(dir);
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
  }
  return dir;
}

function repo(overrides: Record<string, string | null> = {}): string {
  const files: Record<string, string | null> = {
    "src/app/globals.css": themeCss(),
    "src/app/page.tsx":
      'export default function Page() { return <div className="bg-background" />; }\n',
    ...overrides,
  };
  const entries: Record<string, string> = {};
  for (const [key, value] of Object.entries(files)) if (value !== null) entries[key] = value;
  return writeTree(entries);
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

describe("buildSnapshot()", () => {
  it("读取真实仓库：globals.css 与应用层文件非空", () => {
    const snapshot = buildSnapshot();
    expect(snapshot.css).toContain(":root");
    expect(
      snapshot.sourceFiles.some((f: { path: string }) => f.path === "src/app/globals.css"),
    ).toBe(false);
    expect(snapshot.sourceFiles.some((f: { path: string }) => f.path === "src/app/page.tsx")).toBe(
      true,
    );
    expect(snapshot.sourceFiles.length).toBeGreaterThan(100);
  });

  it("src/components/ui 与测试文件不进应用层扫描", () => {
    const snapshot = buildSnapshot();
    expect(
      snapshot.sourceFiles.some((f: { path: string }) => f.path.startsWith("src/components/ui/")),
    ).toBe(false);
    expect(snapshot.sourceFiles.some((f: { path: string }) => f.path.endsWith(".test.tsx"))).toBe(
      false,
    );
    expect(
      snapshot.sourceFiles.some((f: { path: string }) => f.path === "src/lib/design/tokens.ts"),
    ).toBe(false);
  });

  it("缺少 globals.css 时抛出可读错误", () => {
    expect(() => buildSnapshot(writeTree({ "src/app/page.tsx": "export default 1;\n" }))).toThrow(
      /找不到 src\/app\/globals\.css/,
    );
  });
});

describe("runDesignTokenCheck()", () => {
  it("合规仓库返回 0 并打印统计", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void logs.push(line));
    expect(runDesignTokenCheck(repo())).toBe(0);
    expect(logs.join("\n")).toContain("设计 token 校验通过");
  });

  it("缺 @theme 映射返回 1 并打印规则码", () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => void errors.push(line));
    const css = themeCss().replace("  --color-success: hsl(var(--success));\n", "");
    expect(runDesignTokenCheck(repo({ "src/app/globals.css": css }))).toBe(1);
    expect(errors.join("\n")).toContain("THEME_MAPPING_MISSING");
  });

  it("应用层原生状态调色板返回 1", () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => void errors.push(line));
    const dir = repo({ "src/app/page.tsx": 'const a = "bg-green-500";\n' });
    expect(runDesignTokenCheck(dir)).toBe(1);
    expect(errors.join("\n")).toContain("RAW_STATUS_PALETTE");
  });

  it("白名单装饰性调色板不阻断", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = repo({
      "src/components/shared/initial-avatar.tsx": 'const a = "bg-purple-500";\n',
    });
    // purple 本来就不在禁用色系里；换成禁用色系同样因白名单放行
    expect(runDesignTokenCheck(dir)).toBe(0);
  });

  it("缺少 globals.css 时安全失败（退出码 1，不抛异常）", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runDesignTokenCheck(writeTree({ "src/app/page.tsx": "export default 1;\n" }))).toBe(1);
    expect(errorSpy.mock.calls.join("\n")).toContain("无法读取设计 token 快照");
  });
});
