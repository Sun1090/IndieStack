import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildActionErrorSnapshot,
  runActionErrorCheck,
} from "../../../scripts/lib/action-error-check.js";
import { auditActionErrorTranslation } from "./action-errors";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");

describe("错误码翻译门禁（真实仓库）", () => {
  it("当前仓库通过审计", () => {
    expect(runActionErrorCheck(REPO_ROOT)).toBe(0);
  });

  it("快照覆盖 Action 与 schema 的错误码，且不含测试文件", () => {
    const snapshot = buildActionErrorSnapshot(REPO_ROOT);
    expect(snapshot.producers.length).toBeGreaterThan(10);
    expect(snapshot.consumers.length).toBeGreaterThan(100);
    expect(snapshot.producers.some((file) => file.fileName.includes("src/lib/actions/"))).toBe(true);
    for (const file of [...snapshot.producers, ...snapshot.consumers]) {
      expect(file.fileName).not.toMatch(/\.(test|spec)\./);
      expect(file.fileName).not.toContain("database.types.ts");
    }
    const report = auditActionErrorTranslation({
      ...snapshot,
      identicalValueExemptions: {},
      rawDisplayExemptions: {},
    });
    expect(report.codes.length).toBeGreaterThanOrEqual(40);
    for (const code of ["notAuthenticated", "invalidInput", "projectNotFound", "spamRejected"]) {
      expect(report.codes).toContain(code);
    }
    expect(report.rawDisplaySites).toEqual([]);
    expect(report.issues).toEqual([]);
  });

  it("反例：删掉 projectNotFound 文案后立刻报缺键", () => {
    const snapshot = buildActionErrorSnapshot(REPO_ROOT);
    const withoutKey = {
      ...snapshot.messages,
      en: JSON.stringify({ ...JSON.parse(snapshot.messages.en), projectNotFound: undefined }),
    };
    const report = auditActionErrorTranslation({ ...snapshot, messages: withoutKey });
    const issue = report.issues.find(
      (entry) => entry.code === "ACTION_ERROR_KEY_MISSING" && entry.message.includes("projectNotFound"),
    );
    expect(issue?.file).toBe("messages/en/actions.json");
  });

  it("反例：还原修复前的裸渲染与未翻译 helper 调用点", () => {
    const snapshot = buildActionErrorSnapshot(REPO_ROOT);
    const report = auditActionErrorTranslation({
      ...snapshot,
      consumers: [
        ...snapshot.consumers,
        {
          fileName: "src/components/dashboard/project-delete-button.tsx",
          content: `const tc = useTranslations("common");
toast({ title: tc("error"), description: result.error, variant: "destructive" });`,
        },
        {
          fileName: "src/app/auth/mfa/page.tsx",
          content: `import { authErrorKey } from "@/lib/auth/errors";
toast({ title: "MFA", description: authErrorKey(verifyError) });`,
        },
      ],
    });
    expect(
      report.issues.filter((entry) => entry.code === "ACTION_ERROR_RAW_DISPLAY").map((entry) => entry.file),
    ).toContain("src/components/dashboard/project-delete-button.tsx");
    const untranslated = report.issues.find((entry) => entry.code === "ACTION_ERROR_UNTRANSLATED_KEY");
    expect(untranslated?.file).toBe("src/app/auth/mfa/page.tsx");
  });

  it("反例：扫描范围写错（零错误码）时失败封闭", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "indiestack-action-errors-"));
    try {
      fs.mkdirSync(path.join(directory, "src/lib/actions"), { recursive: true });
      fs.writeFileSync(path.join(directory, "src/lib/actions/empty.ts"), "export const a = 1;\n");
      fs.mkdirSync(path.join(directory, "messages/en"), { recursive: true });
      fs.mkdirSync(path.join(directory, "messages/zh-CN"), { recursive: true });
      fs.writeFileSync(path.join(directory, "messages/en/actions.json"), "{}");
      fs.writeFileSync(path.join(directory, "messages/zh-CN/actions.json"), "{}");
      expect(runActionErrorCheck(directory)).toBe(1);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
