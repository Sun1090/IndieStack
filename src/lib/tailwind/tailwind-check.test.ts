/**
 * `pnpm check:tailwind` 门禁行为单测
 * 保证脚本能读真实仓库、排除上游基元目录、按 errors 返回退出码 1、warnings 只提示不阻断。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSnapshot, runTailwindNativeCheck } from "../../../scripts/lib/tailwind-native-check.js";

const THEME_CSS = `@import "tailwindcss";

@theme inline {
  --animate-navprogress: navprogress 0.8s ease-in-out infinite;

  @keyframes navprogress {
    0% { transform: translateX(-100%); }
  }
}
`;

const tempDirs: string[] = [];

function writeTree(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "indiestack-tailwind-"));
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
    "package.json": JSON.stringify({ dependencies: { next: "16.0.0" }, devDependencies: { tailwindcss: "4.3.3" } }),
    "src/app/globals.css": THEME_CSS,
    "src/app/page.tsx": 'export default function Page() { return <div className="bg-linear-to-b" />; }\n',
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
  it("读取真实仓库：无 JS 配置、有主题样式、应用层文件非空", () => {
    const snapshot = buildSnapshot();
    expect(snapshot.configFiles).toEqual([]);
    expect(snapshot.cssFiles.map((f: { path: string }) => f.path)).toContain("src/app/globals.css");
    expect(snapshot.sourceFiles.length).toBeGreaterThan(100);
    expect(snapshot.dependencies).toContain("tailwindcss");
    expect(snapshot.dependencies).not.toContain("tailwindcss-animate");
  });

  it("src/components/ui 只进 excludedFiles，不进应用层扫描", () => {
    const snapshot = buildSnapshot();
    expect(snapshot.sourceFiles.some((f: { path: string }) => f.path.startsWith("src/components/ui/"))).toBe(false);
    expect(snapshot.excludedFiles.some((f: { path: string }) => f.path.startsWith("src/components/ui/"))).toBe(true);
    expect(snapshot.sourceFiles.some((f: { path: string }) => f.path.endsWith(".test.tsx"))).toBe(false);
  });

  it("仓库根出现 tailwind.config.ts 会被发现", () => {
    const dir = repo({ "tailwind.config.ts": "export default {};\n" });
    expect(buildSnapshot(dir).configFiles).toEqual(["tailwind.config.ts"]);
  });
});

describe("runTailwindNativeCheck()", () => {
  it("合规仓库返回 0", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void logs.push(line));
    expect(runTailwindNativeCheck(repo())).toBe(0);
    expect(logs.join("\n")).toContain("Tailwind v4 原生主题校验通过");
  });

  it("JS 配置回归返回 1 并打印规则码", () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => void errors.push(line));
    expect(runTailwindNativeCheck(repo({ "tailwind.config.js": "module.exports = {};\n" }))).toBe(1);
    expect(errors.join("\n")).toContain("TW_CONFIG_FILE_PRESENT");
  });

  it("应用层 v3 类名返回 1", () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => void errors.push(line));
    const dir = repo({ "src/app/page.tsx": 'const a = "bg-gradient-to-b";\n' });
    expect(runTailwindNativeCheck(dir)).toBe(1);
    expect(errors.join("\n")).toContain("bg-linear-to-*");
  });

  it("上游基元的 v3 类名只告警不阻断", () => {
    const warnings: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((line: string) => void warnings.push(line));
    const dir = repo({
      "src/components/ui/button.tsx": 'const a = "focus-visible:outline-none";\n',
    });
    expect(runTailwindNativeCheck(dir)).toBe(0);
    expect(warnings.join("\n")).toContain("非阻断");
  });

  it("缺少 package.json 时安全失败（退出码 1，不抛异常）", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runTailwindNativeCheck(writeTree({ "src/app/globals.css": THEME_CSS }))).toBe(1);
    expect(errorSpy.mock.calls.join("\n")).toContain("无法读取 Tailwind 主题快照");
  });
});
