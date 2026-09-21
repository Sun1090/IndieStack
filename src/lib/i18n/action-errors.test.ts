import { describe, expect, it } from "vitest";
import {
  collectActionErrorCodes,
  collectRawErrorDisplays,
  formatActionErrorIssues,
  auditActionErrorTranslation,
  type ActionErrorSource,
} from "./action-errors";

const EN = JSON.stringify({ notAuthenticated: "Not signed in", invalidInput: "Invalid input" });
const ZH = JSON.stringify({ notAuthenticated: "请先登录", invalidInput: "输入不合法" });

const producer = (content: string, fileName = "src/lib/actions/thing.ts"): ActionErrorSource => ({
  fileName,
  content,
});

const ACTION_IMPORTS = `
import { fail, ok } from "@/lib/types/action-result";
import { z } from "zod";
`;

function codesOf(content: string, fileName?: string): string[] {
  return collectActionErrorCodes(producer(content, fileName)).map((entry) => entry.code);
}

describe("collectActionErrorCodes()", () => {
  it("提取 fail() 字面量错误码", () => {
    expect(codesOf(`${ACTION_IMPORTS}\nexport function a(){ if(!u) return fail("notAuthenticated"); return ok(); }`)).toEqual(
      ["notAuthenticated"],
    );
  });

  it("提取 fail(expr ?? \"code\") 的兜底错误码", () => {
    expect(codesOf(`${ACTION_IMPORTS}\nreturn fail(parsed.error.issues[0]?.message ?? "invalidInput");`)).toEqual(
      ["invalidInput"],
    );
  });

  it("识别 import 别名", () => {
    expect(
      codesOf(`import { fail as failAction } from "@/lib/types/action-result";\nreturn failAction("noTeam");`),
    ).toEqual(["noTeam"]);
  });

  it("忽略未从 action-result 导入的同名本地函数", () => {
    // src/lib/security/codeql-alert-policy.ts 里的 fail("push") 是门禁记账，不是用户可见错误码
    expect(codesOf(`function fail(x){return x}\nfail("push");`)).toEqual([]);
  });

  it("只在导入 zod 的文件里把校验器末位字符串当错误码", () => {
    expect(codesOf(`${ACTION_IMPORTS}\nconst s = z.string().min(1, "projectNameRequired");`)).toEqual([
      "projectNameRequired",
    ]);
    expect(codesOf(`const s = something.min(1, "notACode");`, "src/lib/utils/format.ts")).toEqual([]);
  });

  it("忽略不像错误码的字面量（大写或含空格）", () => {
    expect(codesOf(`${ACTION_IMPORTS}\nreturn fail("Boom Time");\nreturn fail("OK");`)).toEqual([]);
  });

  it("记录错误码所在行", () => {
    const entries = collectActionErrorCodes(
      producer(`${ACTION_IMPORTS}\n\nreturn fail("memberNotFound");`),
    );
    expect(entries).toEqual([{ code: "memberNotFound", line: 6 }]);
  });
});

describe("collectRawErrorDisplays()", () => {
  const display = (content: string) =>
    collectRawErrorDisplays({ fileName: "src/components/x.tsx", content });

  it("标记把 result.error 直接当文案的写法", () => {
    const found = display(`toast({ title: tc("error"), description: result.error });`);
    expect(found).toHaveLength(1);
    expect(found[0]?.text).toContain("description: result.error");
    expect(found[0]?.untranslatedKey).toBe(false);
  });

  it("标记返回错误码的 helper 未翻译直接展示", () => {
    const found = display(
      `import { authErrorKey } from "@/lib/auth/errors";\ntoast({ description: authErrorKey(err) });`,
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.untranslatedKey).toBe(true);
  });

  it("接受 ta(...) 包裹与已翻译文案", () => {
    expect(
      display(`toast({ description: ta(authErrorKey(err)) });`),
    ).toEqual([]);
    expect(display(`toast({ title: t("login.failed"), description: "boom" });`)).toEqual([]);
  });

  it("不误报普通对象属性", () => {
    expect(display(`const row = { description: project.summary, message: "hello" };`)).toEqual([]);
  });
});

function audit(messages: Record<string, string>, overrides: Record<string, unknown> = {}) {
  return auditActionErrorTranslation({
    producers: [producer(`${ACTION_IMPORTS}\nreturn fail("notAuthenticated");\nreturn fail("invalidInput");`)],
    consumers: [],
    messages,
    ...overrides,
  });
}

describe("auditActionErrorTranslation()", () => {
  it("全量对齐时零问题", () => {
    const report = audit({ en: EN, "zh-CN": ZH });
    expect(report.issues).toEqual([]);
    expect(report.codes).toEqual(["invalidInput", "notAuthenticated"]);
    expect(report.keyCounts).toEqual({ en: 2, "zh-CN": 2 });
  });

  it("逐 locale 报告缺失键，并指出产出位置", () => {
    const report = audit({ en: EN, "zh-CN": JSON.stringify({ notAuthenticated: "请先登录" }) });
    const missing = report.issues.filter((issue) => issue.code === "ACTION_ERROR_KEY_MISSING");
    expect(missing).toHaveLength(1);
    expect(missing[0]?.file).toBe("messages/zh-CN/actions.json");
    expect(missing[0]?.message).toContain("invalidInput");
    expect(missing[0]?.message).toContain("src/lib/actions/thing.ts:6");
  });

  it("各 locale 文案逐字相同视为漏翻译，登记豁免才放行", () => {
    const same = { en: EN, "zh-CN": EN };
    expect(audit(same).issues.map((i) => i.code)).toContain("ACTION_ERROR_VALUE_NOT_TRANSLATED");
    const exempted = audit(same, {
      identicalValueExemptions: { invalidInput: "占位文案，两语一致", notAuthenticated: "品牌写法" },
    });
    expect(exempted.issues).toEqual([]);
    expect(exempted.exemptedIdenticalCodes).toEqual(["invalidInput", "notAuthenticated"]);
  });

  it("豁免已不再需要时失败，避免例外清单只增不减", () => {
    const staleIdentical = audit({ en: EN, "zh-CN": ZH }, {
      identicalValueExemptions: { removedCode: "早已删除" },
    });
    expect(staleIdentical.issues.map((i) => i.code)).toContain("ACTION_ERROR_STALE_EXEMPTION");
  });

  it("裸渲染调用点失败，登记豁免后转为通过并计入清单", () => {
    const consumers = [
      {
        fileName: "src/components/dashboard/x.tsx",
        content: `toast({ description: result.error });`,
      },
    ];
    const report = audit({ en: EN, "zh-CN": ZH }, { consumers });
    expect(report.issues.map((i) => i.code)).toContain("ACTION_ERROR_RAW_DISPLAY");
    expect(report.rawDisplaySites).toEqual([{ file: consumers[0]!.fileName, line: 1 }]);

    const exempted = audit({ en: EN, "zh-CN": ZH }, {
      consumers,
      rawDisplayExemptions: { [consumers[0]!.fileName]: "该页只给内部排障看" },
    });
    expect(exempted.issues).toEqual([]);
    expect(exempted.exemptedRawFiles).toEqual([consumers[0]!.fileName]);

    const stale = audit({ en: EN, "zh-CN": ZH }, {
      consumers: [],
      rawDisplayExemptions: { [consumers[0]!.fileName]: "已经改掉了" },
    });
    expect(stale.issues.map((i) => i.code)).toContain("ACTION_ERROR_STALE_EXEMPTION");
  });

  it("提取不到任何错误码时失败封闭", () => {
    const report = auditActionErrorTranslation({
      producers: [producer("export const x = 1;", "src/lib/actions/empty.ts")],
      consumers: [],
      messages: { en: EN, "zh-CN": ZH },
    });
    expect(report.issues.map((i) => i.code)).toEqual(["ACTION_ERROR_NO_PRODUCER_CODES"]);
  });

  it("消息文件损坏或缺失时报错而不是静默通过", () => {
    const broken = audit({ en: "{ not json", "zh-CN": ZH });
    expect(broken.issues.map((i) => i.code)).toContain("ACTION_ERROR_MESSAGE_FILE_INVALID");
    const absent = audit({ "zh-CN": ZH });
    expect(absent.issues.some((i) => i.file === "messages/en/actions.json")).toBe(true);
  });

  it("格式化输出包含规则码、文件与行号", () => {
    const lines = formatActionErrorIssues([
      { code: "ACTION_ERROR_RAW_DISPLAY", file: "src/a.tsx", line: 7, message: "裸渲染" },
      { code: "ACTION_ERROR_KEY_MISSING", file: "messages/en/actions.json", line: null, message: "缺键" },
    ]);
    expect(lines[0]).toBe("[ACTION_ERROR_RAW_DISPLAY] src/a.tsx:7：裸渲染");
    expect(lines[1]).toBe("[ACTION_ERROR_KEY_MISSING] messages/en/actions.json：缺键");
  });
});
