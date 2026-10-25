import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENV_FILE_NAMES,
  credentialLooksConfigured,
  mergeEnvSources,
  parseEnvFileText,
} from "./env-credentials";

describe("credentialLooksConfigured", () => {
  it("空、缺失、纯空白都算未配置", () => {
    expect(credentialLooksConfigured(undefined)).toBe(false);
    expect(credentialLooksConfigured("")).toBe(false);
    expect(credentialLooksConfigured("   ")).toBe(false);
  });

  it("可识别的模板形态算未配置——「非空即有」的假阳性就在这", () => {
    expect(credentialLooksConfigured("https://your-project.supabase.co")).toBe(false);
    expect(credentialLooksConfigured("postgres://postgres.your-project:{{EMAIL_abcdef}}:5432/postgres")).toBe(false);
    expect(credentialLooksConfigured("<paste-your-key>")).toBe(false);
    expect(credentialLooksConfigured("changeme")).toBe(false);
  });

  it("JWT 形态解 payload 再判：模板 key 的 your-project 藏在 base64url 里", () => {
    const payload = Buffer.from(JSON.stringify({ iss: "supabase", ref: "your-project" })).toString("base64url");
    expect(credentialLooksConfigured(`eyJhbGciOiJIUzI1NiJ9.${payload}.ZmFrZXNpZw`)).toBe(false);
    const real = Buffer.from(JSON.stringify({ iss: "supabase", ref: "ntqggnztzvoavjbiillb" })).toString("base64url");
    expect(credentialLooksConfigured(`eyJhbGciOiJIUzI1NiJ9.${real}.ZmFrZXNpZw`)).toBe(true);
  });

  it("解不开的 JWT 形状按原样判——「读不出形状」不是「占位符」，也不是「未配置」", () => {
    expect(credentialLooksConfigured("aaa.!!!.bbb")).toBe(true);
  });

  it("真实形态的凭据算已配置", () => {
    expect(credentialLooksConfigured("https://ntqggnztzvoavjbiillb.supabase.co")).toBe(true);
    expect(credentialLooksConfigured("sbp_realpathtoken123")).toBe(true);
  });
});

describe("parseEnvFileText", () => {
  it("解析 KEY=value、注释、export 前缀与引号包裹；畸形行跳过", () => {
    const parsed = parseEnvFileText(
      ["# comment", "", "A=1", 'B="two"', "C='three'", "export D=four", "=nokey", "E", "2BAD=x", 'F="unclosed'].join("\n"),
    );
    expect(parsed).toEqual({ A: "1", B: "two", C: "three", D: "four", F: '"unclosed' });
  });

  it(`从仓库的 .env.example 读出的真实模板值，判据必须认得（不是拟态样本）`, () => {
    // 读仓库文件而不是抄值：`.env.example` 改了词表没跟上，这条就该红。
    const example = parseEnvFileText(readFileSync(resolve(process.cwd(), ".env.example"), "utf8"));
    expect(credentialLooksConfigured(example.NEXT_PUBLIC_SUPABASE_URL)).toBe(false);
    expect(credentialLooksConfigured(example.SUPABASE_DB_URL)).toBe(false);
    expect(credentialLooksConfigured(example.NEXT_PUBLIC_SUPABASE_ANON_KEY)).toBe(false);
  });
});

describe("mergeEnvSources", () => {
  it("先到先得：process.env 放最前，文件只补位", () => {
    const merged = mergeEnvSources([
      { K: "from-process" },
      { K: "from-file" },
    ]);
    expect(merged.K).toBe("from-process");
  });

  it("已配上真实值的键不被后面的占位符顶掉", () => {
    expect(mergeEnvSources([{ K: "real-value" }, { K: "your-project" }]).K).toBe("real-value");
  });

  it("占位符值可被后面的真实值顶掉（先到先得的前提是「已配上」）", () => {
    expect(mergeEnvSources([{ K: "your-project" }, { K: "real-value" }]).K).toBe("real-value");
  });
});

describe("ENV_FILE_NAMES", () => {
  it("名单按「具体 → 笼统」排——merge 是先到先得，顺序反了就让 .env 赢", () => {
    // 这一条钉的是我真实写反过的地方（第一版多写了 .reverse()）。
    expect(ENV_FILE_NAMES[0]).toBe(".env.local");
    expect(ENV_FILE_NAMES[ENV_FILE_NAMES.length - 1]).toBe(".env");
  });
});
