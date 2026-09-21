/**
 * `pnpm check:a11y` 门禁行为单测（D10）。
 *
 * 覆盖 IO 层：读真实仓库、排除上游基元与测试文件、失败封闭，
 * 并留下一条**回归**：把已修复的真实文件里的 aria-label 抠掉，门禁必须立刻变红。
 * 上一版门禁正是靠「谁都看不出它什么都没做」活下来的，所以这里连计数器一起断言。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSnapshot, runA11yCheck, UI_PRIMITIVES_DIR } from "../../../scripts/lib/a11y-check.js";
import { auditA11y } from "./a11y-rules";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const tempDirs: string[] = [];

function writeTree(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "indiestack-a11y-"));
  tempDirs.push(dir);
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(dir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  }
  return dir;
}

afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

describe("a11y 门禁读真实仓库", () => {
  it("当前仓库没有未标注的图标按钮，也没有缺 alt 的图片", () => {
    expect(runA11yCheck(REPO_ROOT).errors).toEqual([]);
  });

  it("计数器证明规则可达：纯图标按钮数量必须大于 0", () => {
    const { stats } = runA11yCheck(REPO_ROOT);
    // 规则曾经永远命中不到（iconOnly=0 也照样打印通过），所以这条断言本身就是回归测试
    expect(stats.iconOnlyButtons).toBeGreaterThan(0);
    expect(stats.buttons).toBeGreaterThan(stats.iconOnlyButtons);
    expect(stats.scannedFiles).toBeGreaterThan(100);
  });

  it("快照与仓库现状一致：排除 ui 基元与测试文件", () => {
    const snapshot = buildSnapshot(REPO_ROOT);
    expect(snapshot.length).toBeGreaterThan(100);
    expect(snapshot.some((f) => f.path.startsWith(`${UI_PRIMITIVES_DIR}/`))).toBe(false);
    expect(snapshot.some((f) => /\.test\.tsx$/.test(f.path))).toBe(false);
    const counted = (fs.readdirSync(path.join(REPO_ROOT, "src"), { recursive: true }) as string[]).filter(
      (entry) =>
        typeof entry === "string" &&
        entry.endsWith(".tsx") &&
        !entry.includes(".test.") &&
        !entry.startsWith(`components${path.sep}ui${path.sep}`),
    );
    expect(snapshot.length).toBe(counted.length);
  });

  it("抠掉真实文件里的 aria-label 后，门禁必须失败（证明它会失败）", () => {
    const real = buildSnapshot(REPO_ROOT).find((f) => f.path.endsWith("admin-users-page.tsx"));
    expect(real).toBeDefined();
    const stripped = { ...real!, content: real!.content.replace(/aria-label=\{t\("users\.changeRole"\)\}/, "") };
    const report = auditA11y([stripped]);
    expect(report.errors.map((i) => i.code)).toEqual(["ICON_BUTTON_UNLABELED"]);
    expect(report.errors[0].file).toContain("admin-users-page.tsx");
  });

  it("去掉 <img> 的 alt 同样会失败", () => {
    const dir = writeTree({ "src/app/page.tsx": 'export const p = () => <img src="/a.png" />;\n' });
    expect(runA11yCheck(dir).errors.map((i) => i.code)).toEqual(["IMG_MISSING_ALT"]);
  });
});

describe("a11y 门禁：临时仓库", () => {
  it("未标注图标按钮 → 退出码语义为失败", () => {
    const dir = writeTree({
      "src/app/x/page.tsx":
        'export const p = () => (\n  <Button variant="ghost" size="icon">\n    <ArrowLeft className="h-5 w-5" />\n  </Button>\n);\n',
    });
    const report = runA11yCheck(dir);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].code).toBe("ICON_BUTTON_UNLABELED");
    expect(report.errors[0].line).toBe(2);
  });

  it("标注齐全 + 图标与文本混排 → 通过", () => {
    const dir = writeTree({
      "src/app/x/page.tsx":
        'export const p = () => (\n  <>\n    <Button aria-label={t("back")}><ArrowLeft /></Button>\n    <Button><Plus /> {t("create")}</Button>\n  </>\n);\n',
    });
    expect(runA11yCheck(dir).errors).toEqual([]);
  });

  it("只有 ui 基元时视为没有可审文件，失败封闭", () => {
    const dir = writeTree({
      "src/components/ui/button.tsx": 'export const b = () => <button><Icon /></button>;\n',
    });
    expect(runA11yCheck(dir).errors.map((i) => i.code)).toEqual(["A11Y_NO_FILES"]);
  });

  it("src 不存在时失败而不是通过", () => {
    const dir = writeTree({ "package.json": "{}\n" });
    expect(runA11yCheck(dir).errors.map((i) => i.code)).toEqual(["A11Y_NO_FILES"]);
  });
});
