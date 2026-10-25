/**
 * env 取数口的 IO 侧测试：读的是**临时目录**里的 env 文件，
 * 绝不碰仓库/开发机真实的 `.env.local`——否则用例结果随机器变化，
 * 而这条链存在的意义恰恰是「读对来源」。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readEnvFile, readEnvSources } from "../../scripts/lib/env-sources.js";

const created: string[] = [];

/** 传 env 给加载器；缺的键就是「环境里没有」，所以不必补 ProcessEnv 的必填键。 */
function envOf(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

function tempRepo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "env-sources-"));
  created.push(root);
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), content);
  }
  return root;
}

afterEach(() => {
  while (created.length > 0) {
    fs.rmSync(created.pop()!, { recursive: true, force: true });
  }
});

describe("readEnvFile", () => {
  it("不存在返回空表（读不到不是错误，探测会以『未知』收场）", () => {
    expect(readEnvFile(".env.local", tempRepo({}))).toEqual({});
  });

  it("解析真实文件内容", () => {
    const root = tempRepo({ ".env.local": "A=1\n# c\nB=2\n" });
    expect(readEnvFile(".env.local", root)).toEqual({ A: "1", B: "2" });
  });
});

describe("readEnvSources", () => {
  it("这正是修掉的那个假阴性：凭据只在 .env.local 时，process.env 空表也必须读到", () => {
    const root = tempRepo({ ".env.local": "SUPABASE_PROJECT_REF=abc123defg\n" });
    const merged = readEnvSources(root, envOf({}));
    expect(merged.SUPABASE_PROJECT_REF).toBe("abc123defg");
  });

  it("process.env 优先于文件（先到先得）", () => {
    const root = tempRepo({ ".env.local": "K=from-file\n" });
    expect(readEnvSources(root, envOf({ K: "from-process" })).K).toBe("from-process");
  });

  it(`.env.local 赢 .env：名单顺序错了这里就红`, () => {
    const root = tempRepo({
      ".env.local": "K=local\n",
      ".env": "K=plain\n",
    });
    expect(readEnvSources(root, envOf({})).K).toBe("local");
  });

  it(`文件里的占位符不会顶掉 process.env 的真实值，但真实文件值可补位`, () => {
    const root = tempRepo({
      ".env.local": "URL=https://your-project.supabase.co\nOTHER=sbp_real\n",
    });
    const merged = readEnvSources(root, envOf({ URL: "https://real.supabase.co" }));
    expect(merged.URL).toBe("https://real.supabase.co");
    expect(merged.OTHER).toBe("sbp_real");
  });

  it("env: null 时只取文件（供测试构造『机器上只有 .env.local』的形态）", () => {
    const root = tempRepo({ ".env.local": "ONLY=file-value\n" });
    expect(readEnvSources(root, null)).toEqual({ ONLY: "file-value" });
  });
});
