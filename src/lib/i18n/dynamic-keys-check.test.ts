/**
 * `pnpm check:dynamic-keys` 门禁行为单测（D04 补集）。
 *
 * 覆盖 IO 层：读真实消息与源码、计数器非零（证明真的扫过）、临时仓库反例、失败封闭。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DYNAMIC_KEY_CONTRACTS,
  buildLeafKeysByLocale,
  buildSourceFiles,
  runDynamicKeysCheck,
} from "../../../scripts/lib/dynamic-keys-check.js";
import { auditDynamicKeys } from "./dynamic-keys";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const tempDirs: string[] = [];

function writeTree(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "indiestack-dynkeys-"));
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

const contract = {
  id: "demo",
  keyPrefix: "demo.things",
  values: ["alpha", "beta"],
  source: "@/lib/demo#THINGS",
  reason: "示例",
};

describe("动态键门禁读真实仓库", () => {
  it("当前仓库通过，且计数器证明契约与模板都不是零", () => {
    const report = runDynamicKeysCheck(REPO_ROOT);
    expect(report.issues).toEqual([]);
    expect(report.stats.contracts).toBeGreaterThan(5);
    expect(report.stats.templates).toBeGreaterThan(5);
    expect(report.stats.locales).toBe(2);
    expect(report.stats.values).toBeGreaterThan(30);
  });

  it("契约登记表本身不允许为空", () => {
    expect(DYNAMIC_KEY_CONTRACTS.length).toBeGreaterThan(5);
    for (const item of DYNAMIC_KEY_CONTRACTS) {
      expect(item.values.length, item.id).toBeGreaterThan(0);
      expect(item.source, item.id).toMatch(/^@\//);
      expect(item.reason, item.id).not.toBe("");
    }
  });

  it("通知类型契约的取值来自代码常量，而不是抄消息文件", async () => {
    const { NOTIFICATION_TYPES } = await import("../notifications/types");
    const notification = DYNAMIC_KEY_CONTRACTS.find((c) => c.id === "notification-types");
    expect(notification?.values).toEqual(NOTIFICATION_TYPES);
    expect(notification?.keyPrefix).toBe("dashboard.notifications.list.types");
  });

  it("快照读取：两个 locale 各自成集，命名空间取自文件名", () => {
    const leaves = buildLeafKeysByLocale(REPO_ROOT) as Record<string, ReadonlySet<string>>;
    expect(Object.keys(leaves).sort()).toEqual(["en", "zh-CN"]);
    expect(leaves["en"].has("dashboard.notifications.list.types.system")).toBe(true);
    expect(buildSourceFiles(REPO_ROOT).length).toBeGreaterThan(100);
  });
});

describe("动态键门禁：临时仓库", () => {
  it("缺一个 locale 的键 → DYNAMIC_KEY_MISSING", () => {
    const dir = writeTree({
      "messages/en/demo.json": JSON.stringify({ things: { alpha: "A", beta: "B" } }),
      "messages/zh-CN/demo.json": JSON.stringify({ things: { alpha: "A" } }),
      "src/app/page.tsx": 'const t = useTranslations("demo");\nreturn t(`things.${x}`);\n',
    });
    const report = runDynamicKeysCheck(dir, { contracts: [contract] });
    expect(report.issues.map((i) => i.code)).toEqual(["DYNAMIC_KEY_MISSING"]);
    expect(report.issues[0].locale).toBe("zh-CN");
  });

  it("前缀下有集合之外的键 → DYNAMIC_KEY_ORPHAN", () => {
    const dir = writeTree({
      "messages/en/demo.json": JSON.stringify({ things: { alpha: "A", beta: "B", gamma: "G" } }),
    });
    const report = runDynamicKeysCheck(dir, { contracts: [contract] });
    expect(report.issues.map((i) => i.code)).toEqual(["DYNAMIC_KEY_ORPHAN"]);
  });

  it("源码里出现未登记的动态前缀 → DYNAMIC_KEY_UNREGISTERED_TEMPLATE", () => {
    const dir = writeTree({
      "messages/en/demo.json": JSON.stringify({ things: { alpha: "A", beta: "B" } }),
      "messages/zh-CN/demo.json": JSON.stringify({ things: { alpha: "A", beta: "B" } }),
      "src/app/other.tsx": 'const t = useTranslations("demo");\nreturn t(`widgets.${w}`);\n',
    });
    const report = runDynamicKeysCheck(dir, { contracts: [contract] });
    expect(report.issues.map((i) => i.code)).toEqual(["DYNAMIC_KEY_UNREGISTERED_TEMPLATE"]);
    expect(report.issues[0].key).toBe("demo.widgets");
  });

  it("消息目录不存在 → 失败封闭而不是空循环通过", () => {
    const dir = writeTree({ "src/app/page.tsx": "export const a = 1;\n" });
    expect(runDynamicKeysCheck(dir, { contracts: [contract] }).issues.map((i) => i.code)).toEqual([
      "DYNAMIC_KEY_NO_LOCALES",
    ]);
  });

  it("契约集合被清空 → DYNAMIC_KEY_NO_CONTRACTS", () => {
    const dir = writeTree({ "messages/en/demo.json": "{}" });
    expect(runDynamicKeysCheck(dir, { contracts: [] }).issues.map((i) => i.code)).toEqual([
      "DYNAMIC_KEY_NO_CONTRACTS",
    ]);
  });

  it("坏 JSON 直接抛错，不被当成「没有问题」", () => {
    const dir = writeTree({ "messages/en/demo.json": "{ not json" });
    expect(() => runDynamicKeysCheck(dir, { contracts: [contract] })).toThrow(/解析失败/);
  });
});

describe("审计函数可独立调用", () => {
  it("纯函数版与 IO 版对同一份输入结论一致", () => {
    const input = {
      contracts: [contract],
      leafKeysByLocale: {
        en: new Set(["demo.things.alpha", "demo.things.beta"]),
        "zh-CN": new Set(["demo.things.alpha", "demo.things.beta"]),
      },
    };
    expect(auditDynamicKeys(input).issues).toEqual([]);
  });
});
