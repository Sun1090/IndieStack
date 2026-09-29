/**
 * 客户端产物「服务端专用变量名」判据的单测
 *
 * 覆盖面刻意分两半：合成输入证明规则本身有牙齿（改一个名字就红），
 * 真实产物证明它今天有 0 个命中且**不是扫空了**（分母非零）。
 * 后者是本仓库反复付过学费的形状——「零发现」和「什么都没在看」长得一模一样。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SERVER_ONLY_NAMES,
  formatClientEnvIssues,
  inspectClientArtifactEnvNames,
} from "./client-artifact-env";

const CHUNKS = resolve(__dirname, "../../../.next/static/chunks");

describe("inspectClientArtifactEnvNames()", () => {
  it("合成输入：名字出现即红，并点名是哪一个", () => {
    const issues = inspectClientArtifactEnvNames([
      { path: "a.js", content: 'var k="sk_live_x";var n="STRIPE_SECRET_KEY";' },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("CLIENT_ARTIFACT_SERVER_ONLY_NAME");
    expect(issues[0].message).toContain("STRIPE_SECRET_KEY");
  });

  it("合成输入：同名子串不算（STRIPE_WEBHOOK_SECRET 不该被 STRIPE_SECRET 命中）", () => {
    // 清单里两个名字互为前缀的没有，但这条守住「子串就算」的改法——
    // 那种改法会让命中集随清单变长而虚增。
    const issues = inspectClientArtifactEnvNames([{ path: "a.js", content: "NEXT_PUBLIC_X" }], {
      names: ["SUPABASE"],
    });
    expect(issues).toEqual([]);
  });

  it("空扫描报红，不把「没扫到」读成「干净」", () => {
    const issues = inspectClientArtifactEnvNames([], { minFiles: 1 });
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("CLIENT_ARTIFACT_NOT_SCANNED");
  });

  it("低于分母也报红（分母不是摆设）", () => {
    const issues = inspectClientArtifactEnvNames([{ path: "a.js", content: "" }], { minFiles: 5 });
    expect(issues[0].code).toBe("CLIENT_ARTIFACT_NOT_SCANNED");
  });

  it("清单本身没有重复项（重复会让「命中哪一个」变得不确定）", () => {
    expect(new Set(SERVER_ONLY_NAMES).size).toBe(SERVER_ONLY_NAMES.length);
  });

  it("真实生产产物：0 命中，且分母非零（证明不是扫空了）", () => {
    // 没有构建产物时**跳过并说明**，而不是报绿：这条规则的判据需要真实产物，
    // 没有产物时唯一诚实的说法是「没判」，`check:bundle` 会在更早一步因为缺产物而失败。
    let names: string[];
    try {
      names = readdirSync(CHUNKS);
    } catch {
      console.warn("跳过：没有 .next/static/chunks，这条规则需要先 pnpm build");
      return;
    }
    const files = names
      .filter((name) => name.endsWith(".js"))
      .map((name) => ({
        path: relative(CHUNKS, join(CHUNKS, name)).split("\\").join("/"),
        content: readFileSync(join(CHUNKS, name), "utf8"),
      }));
    // 分母：客户端脚本产物必须真的被读到了（实测几十个），否则下面那个 [] 没有意义。
    expect(files.length).toBeGreaterThan(10);
    expect(inspectClientArtifactEnvNames(files, { minFiles: 10 })).toEqual([]);
  });

  it("格式器把码带进每一条，空数组渲染成空串", () => {
    expect(
      formatClientEnvIssues([
        { code: "CLIENT_ARTIFACT_SERVER_ONLY_NAME", subject: "a.js", message: "坏了" },
      ]),
    ).toBe("  - [CLIENT_ARTIFACT_SERVER_ONLY_NAME] a.js: 坏了");
    expect(formatClientEnvIssues([])).toBe("");
  });
});
