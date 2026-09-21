import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDirectionSnapshot, runDirectionCheck } from "../../../scripts/lib/direction-check.js";
import { auditDirection } from "./direction";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");

describe("书写方向门禁（真实仓库）", () => {
  it("当前仓库的应用层没有物理方向类", () => {
    expect(runDirectionCheck(REPO_ROOT)).toBe(0);
  });

  it("快照覆盖足量应用层文件，并排除 shadcn 基元与测试", () => {
    const files = buildDirectionSnapshot(REPO_ROOT);
    expect(files.length).toBeGreaterThan(100);
    for (const file of files) {
      expect(file.fileName).not.toMatch(/^src\/components\/ui\//);
      expect(file.fileName).not.toMatch(/\.(test|spec)\./);
      expect(file.fileName).toMatch(/^src\/.*\.tsx$/);
    }
    // 真实存在的应用层目录要在扫描范围内，否则「全绿」可能只是没扫到
    expect(files.some((file) => file.fileName.startsWith("src/app/(marketing)/"))).toBe(true);
    expect(files.some((file) => file.fileName.startsWith("src/app/dashboard/"))).toBe(true);
    expect(files.some((file) => file.fileName.startsWith("src/components/dashboard/"))).toBe(true);
  });

  it("反例：把任一处逻辑方向类改回物理写法就会失败", () => {
    const files = buildDirectionSnapshot(REPO_ROOT);
    const found = files.find((file) => /[\s"']ms-[\w[]/.test(file.content));
    if (!found) throw new Error("应用层里应当至少有一个 ms-* 类名可用于反例");
    const target = found;
    const reverted = {
      fileName: target.fileName,
      content: target.content.replace(/([\s"'])ms-/, "$1ml-"),
    };
    expect(target.content).not.toBe(reverted.content);
    const report = auditDirection({
      files: files.map((file) => (file.fileName === reverted.fileName ? reverted : file)),
    });
    expect(report.issues.map((issue) => issue.file)).toEqual([target.fileName]);
    expect(report.issues[0].key).toBe("MARGIN_EDGE");
  });

  it("反例：新增 inset 物理写法同样被挡住", () => {
    const files = buildDirectionSnapshot(REPO_ROOT);
    const extra = {
      fileName: "src/app/dashboard/new-panel.tsx",
      content: 'export const P = () => <div className="absolute right-4 top-2" />;\n',
    };
    const report = auditDirection({ files: [...files, extra] });
    expect(report.issues.map((issue) => issue.key)).toEqual(["INSET_EDGE"]);
  });
});

describe("书写方向门禁：临时仓库", () => {
  function withFiles(write: (root: string) => void) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "indiestack-direction-"));
    try {
      write(directory);
      return runDirectionCheck(directory);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  const writePage = (root: string, classes: string) => {
    fs.mkdirSync(path.join(root, "src/app"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "src/app/page.tsx"),
      `export default function Page() { return <div className="${classes}" />; }\n`,
    );
  };

  it("src 不存在时失败而不是通过", () => {
    expect(withFiles(() => {})).toBe(1);
  });

  it("物理方向类失败，逻辑方向类通过", () => {
    expect(withFiles((root) => writePage(root, "flex items-center mr-2"))).toBe(1);
    expect(withFiles((root) => writePage(root, "flex items-center me-2"))).toBe(0);
  });

  it("只有 ui 基元时视为没有可审文件，失败封闭", () => {
    expect(
      withFiles((root) => {
        fs.mkdirSync(path.join(root, "src/components/ui"), { recursive: true });
        fs.writeFileSync(
          path.join(root, "src/components/ui/button.tsx"),
          'export const B = () => <button className="mr-2" />;\n',
        );
      }),
    ).toBe(1);
  });
});
