import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { falsifyTarget } from "../../../scripts/lib/rule-falsification-run.js";
import type { FalsificationTarget } from "./rule-falsification.ts";

const created: string[] = [];

function fixtureRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-"));
  created.push(dir);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "src", "rule.ts"),
    "export function inspectRules(): string[] {\n  const issues: string[] = [];\n  return issues;\n}\n",
  );
  return dir;
}

const TARGET: FalsificationTarget = {
  file: "src/rule.ts",
  function: "inspectRules",
  neuteredReturn: "return [];",
  testFile: "src/rule.test.ts",
};

afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("falsifyTarget()", () => {
  it("中性化 → 跑套件 → 复原，且复原是逐字节的", () => {
    const root = fixtureRepo();
    const before = fs.readFileSync(path.join(root, TARGET.file), "utf8");
    let seenDuringRun = "";
    const outcome = falsifyTarget(root, TARGET, (_root, testFile) => {
      expect(testFile).toBe(TARGET.testFile);
      // 运行那一刻文件必须确实是变异后的内容，否则这道断言什么都没测到。
      seenDuringRun = fs.readFileSync(path.join(root, TARGET.file), "utf8");
      return " Tests 8 failed | 6 passed\n";
    });
    expect(outcome.mutationApplied).toBe(true);
    expect(outcome.verdict).toBe("bites");
    expect(outcome.failedTests).toBe(8);
    expect(seenDuringRun).toContain("return [];\n\n  const issues");
    expect(fs.readFileSync(path.join(root, TARGET.file), "utf8")).toBe(before);
  });

  it("跑套件时抛错也必须复原（finally，不是靠运气）", () => {
    const root = fixtureRepo();
    const before = fs.readFileSync(path.join(root, TARGET.file), "utf8");
    expect(() =>
      falsifyTarget(root, TARGET, () => {
        throw new Error("vitest crashed");
      }),
    ).toThrow("vitest crashed");
    expect(fs.readFileSync(path.join(root, TARGET.file), "utf8")).toBe(before);
  });

  it("判定函数不存在时不动文件，并明说「没打上」", () => {
    const root = fixtureRepo();
    const before = fs.readFileSync(path.join(root, TARGET.file), "utf8");
    const outcome = falsifyTarget(root, { ...TARGET, function: "notThere" }, () => {
      throw new Error("不该被调用");
    });
    expect(outcome.mutationApplied).toBe(false);
    expect(outcome.verdict).toBe("unreadable");
    expect(fs.readFileSync(path.join(root, TARGET.file), "utf8")).toBe(before);
  });
});
