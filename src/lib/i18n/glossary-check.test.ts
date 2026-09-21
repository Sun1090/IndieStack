import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  GLOSSARY_EXEMPTIONS,
  buildGlossarySnapshot,
  runGlossaryCheck,
} from "../../../scripts/lib/glossary-check.js";
import { GLOSSARY, GLOSSARY_DOC_FILE, auditGlossary } from "./glossary";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");

describe("术语一致性门禁（真实仓库）", () => {
  it("当前仓库通过术语一致性检查", () => {
    expect(runGlossaryCheck(REPO_ROOT)).toBe(0);
  });

  it("快照按 `namespace.path` 扁平化，数组元素不参与术语比对", () => {
    const snapshot = buildGlossarySnapshot(REPO_ROOT);
    const en = snapshot.messages.en;
    const zh = snapshot.messages["zh-CN"];
    expect(Object.keys(en).length).toBeGreaterThan(800);
    expect(en["dashboard.team.list.roles.owner"]).toBe("Owner");
    expect(zh["dashboard.team.list.roles.owner"]).toBe("所有者");
    // 长文（`blog.posts[].content`）里「组织」等词是正常用法，逐条制裁只会制造噪声
    expect(Object.keys(zh).some((key) => /^blog\.posts\.\d+\./.test(key))).toBe(false);
    expect(Object.keys(zh).some((key) => /^terms\.sections\.\d+\./.test(key))).toBe(false);
  });

  it("术语表与文档表格逐项相等", () => {
    const snapshot = buildGlossarySnapshot(REPO_ROOT);
    const report = auditGlossary({ ...snapshot, exemptions: GLOSSARY_EXEMPTIONS });
    expect(report.issues).toEqual([]);
    expect(Object.keys(report.approvedUsage).sort()).toEqual(GLOSSARY.map((e) => e.term).sort());
    for (const [term, used] of Object.entries(report.approvedUsage)) {
      expect(used, term).toBeGreaterThan(0);
    }
    expect(report.matchedTerms).toBeGreaterThan(150);
    expect(report.exempted).toEqual([]);
  });

  it("豁免表当前为空，且每条登记都必须带理由", () => {
    for (const [key, reason] of Object.entries(GLOSSARY_EXEMPTIONS)) {
      expect(reason, key).not.toBe("");
    }
  });
});

describe("术语一致性门禁：反例（复现修掉之前的真实值）", () => {
  function auditRealWith(overrides: Record<string, string>) {
    const snapshot = buildGlossarySnapshot(REPO_ROOT);
    return auditGlossary({
      messages: { en: snapshot.messages.en, "zh-CN": { ...snapshot.messages["zh-CN"], ...overrides } },
      glossaryDoc: snapshot.glossaryDoc,
      exemptions: GLOSSARY_EXEMPTIONS,
    });
  }

  it("把「账户」写回「账号」会被挡住", () => {
    const report = auditRealWith({
      "dashboard.settings.sections.security.devicesDesc": "当前登录本账号的设备；吊销后该设备将被登出。",
    });
    const issues = report.issues.filter((issue) => issue.code === "GLOSSARY_TERM_FORBIDDEN");
    expect(issues.map((issue) => issue.key)).toEqual([
      "dashboard.settings.sections.security.devicesDesc",
    ]);
    expect(issues[0].message).toContain("「账户」");
  });

  it("团队角色名写回「拥有者」会被挡住", () => {
    const report = auditRealWith({ "dashboard.team.list.roles.owner": "拥有者" });
    expect(
      report.issues.filter((issue) => issue.code === "GLOSSARY_TERM_FORBIDDEN").map((issue) => issue.key),
    ).toEqual(["dashboard.team.list.roles.owner"]);
  });

  it("文档表格与代码不一致时失败", () => {
    const snapshot = buildGlossarySnapshot(REPO_ROOT);
    const broken = snapshot.glossaryDoc.replace("| `account` | 账户 |", "| `account` | 帐号 |");
    expect(broken).not.toBe(snapshot.glossaryDoc);
    const report = auditGlossary({
      messages: snapshot.messages,
      glossaryDoc: broken,
      exemptions: GLOSSARY_EXEMPTIONS,
    });
    expect(
      report.issues.filter((issue) => issue.code === "GLOSSARY_DOC_MISMATCH").map((issue) => issue.file),
    ).toEqual([GLOSSARY_DOC_FILE, GLOSSARY_DOC_FILE]);
  });
});

describe("术语一致性门禁：失败封闭", () => {
  const onlyAccount = GLOSSARY.filter((item) => item.term === "account");

  function withRepo(write: (root: string) => void) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "indiestack-glossary-"));
    try {
      write(directory);
      // 只带 `account` 一条：临时目录里没有其它术语，完整表会先撞上僵尸条目规则
      return runGlossaryCheck(directory, onlyAccount);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  const writePair = (root: string, en: string, zh: string) => {
    // 消息文件的根就是命名空间本身，不再包一层 common
    for (const [locale, content] of [
      ["en", `{"account":"${en}"}`],
      ["zh-CN", `{"account":"${zh}"}`],
    ] as const) {
      fs.mkdirSync(path.join(root, "messages", locale), { recursive: true });
      fs.writeFileSync(path.join(root, "messages", locale, "common.json"), content);
    }
    fs.mkdirSync(path.join(root, "docs", "architecture"), { recursive: true });
    fs.writeFileSync(
      path.join(root, GLOSSARY_DOC_FILE),
      "## 术语表\n\n| 英文术语 | 指定译法 | 禁止变体 | 说明 |\n|---|---|---|---|\n" +
        "| `account` | 账户 | `账号`、`帐户` | 测试 |\n",
    );
  };

  it("中文用词不一致时失败", () => {
    expect(withRepo((root) => writePair(root, "Your account", "你的账号"))).toBe(1);
  });

  it("术语一致时通过", () => {
    expect(withRepo((root) => writePair(root, "Your account", "你的账户"))).toBe(0);
  });

  it("术语表文档缺失时失败，而不是跳过比对", () => {
    expect(
      withRepo((root) => {
        writePair(root, "Your account", "你的账户");
        fs.rmSync(path.join(root, GLOSSARY_DOC_FILE));
      }),
    ).toBe(1);
  });

  it("一个术语都没命中（消息被清空）时失败", () => {
    expect(withRepo((root) => writePair(root, "Hello there", "你好"))).toBe(1);
  });
});
