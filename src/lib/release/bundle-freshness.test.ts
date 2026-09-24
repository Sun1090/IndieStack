/**
 * 构建产物新鲜度判定单测。
 *
 * 除了纯函数本身，还用一个临时目录验证 IO 层真的能把「源码比产物新」读出来——
 * 这条门禁的全部意义在于它量的是当前源码的产物，判错方向就等于没有门禁。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildFreshnessSnapshot,
  runBundleCheck,
} from "../../../scripts/lib/bundle-freshness-check.js";
import { newestStamp, sourcesNewerThan } from "./bundle-freshness";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeRepo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-freshness-"));
  tempDirs.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

/** 显式设定 mtime，避免依赖测试机器的时钟精度。 */
function touch(full: string, mtimeSeconds: number): void {
  fs.utimesSync(full, mtimeSeconds, mtimeSeconds);
}

describe("newestStamp", () => {
  it("空集合返回 null，让调用方自己决定无从比较时怎么办", () => {
    expect(newestStamp([])).toBeNull();
  });

  it("取最新的一个，并且忽略拿不到时间戳的条目", () => {
    const newest = newestStamp([
      { path: "a", mtimeMs: 1_000 },
      { path: "b", mtimeMs: 3_000 },
      { path: "c", mtimeMs: Number.NaN },
    ]);
    expect(newest).toEqual({ path: "b", mtimeMs: 3_000 });
  });

  it("全是无效时间戳时同样返回 null", () => {
    expect(newestStamp([{ path: "a", mtimeMs: Number.POSITIVE_INFINITY }])).toBeNull();
  });
});

describe("sourcesNewerThan", () => {
  it("只报出晚于构建的输入，按路径排序以便输出稳定", () => {
    const stale = sourcesNewerThan(
      [
        { path: "src/z.ts", mtimeMs: 5_000 },
        { path: "src/a.ts", mtimeMs: 1_000 },
        { path: "messages/en.json", mtimeMs: 9_000 },
      ],
      4_000,
    );
    expect(stale).toEqual(["messages/en.json", "src/z.ts"]);
  });

  it("时间戳相等不算过期：构建过程会读到同一秒内的文件", () => {
    expect(sourcesNewerThan([{ path: "src/a.ts", mtimeMs: 4_000 }], 4_000)).toEqual([]);
  });

  it("产物时间戳缺失时不报任何文件（没有基准可比）", () => {
    expect(sourcesNewerThan([{ path: "src/a.ts", mtimeMs: 5_000 }], Number.NaN)).toEqual([]);
  });

  it("跳过源码侧拿不到时间戳的条目", () => {
    expect(
      sourcesNewerThan(
        [
          { path: "src/broken.ts", mtimeMs: Number.NaN },
          { path: "src/ok.ts", mtimeMs: 10_000 },
        ],
        4_000,
      ),
    ).toEqual(["src/ok.ts"]);
  });
});

describe("buildFreshnessSnapshot（IO）", () => {
  it("构建之后改了源码，就要报出那个文件", () => {
    const root = makeRepo({
      "src/app/page.tsx": "export default function Page() { return null; }",
      "messages/en.json": "{}",
      ".next/static/chunks/main.js": "old bundle",
    });
    touch(path.join(root, ".next/static/chunks/main.js"), 2_000);
    touch(path.join(root, "src/app/page.tsx"), 3_000);
    touch(path.join(root, "messages/en.json"), 1_000);

    const snapshot = buildFreshnessSnapshot(root);
    expect(snapshot.buildMtimeMs).toBe(2_000_000);
    expect(snapshot.stale).toEqual(["src/app/page.tsx"]);
  });

  it("源码都早于构建时没有过期项，且不把 .next 自己算作输入", () => {
    const root = makeRepo({
      "src/app/page.tsx": "export default function Page() { return null; }",
      "messages/en.json": "{}",
      ".next/static/chunks/main.js": "fresh bundle",
    });
    touch(path.join(root, "src/app/page.tsx"), 1_000);
    touch(path.join(root, "messages/en.json"), 1_500);
    touch(path.join(root, ".next/static/chunks/main.js"), 2_000);

    const snapshot = buildFreshnessSnapshot(root);
    expect(snapshot.stale).toEqual([]);
    expect(snapshot.sources.some((stamp) => stamp.path.startsWith(".next/"))).toBe(false);
  });

  it("没有构建产物时报出基准缺失，而不是静默通过", () => {
    const root = makeRepo({ "src/app/page.tsx": "x" });
    expect(buildFreshnessSnapshot(root).buildMtimeMs).toBeNull();
  });

  it("根配置也是输入：改 next.config.ts 足以让产物过期", () => {
    const root = makeRepo({
      "next.config.ts": "export default {}",
      ".next/static/chunks/main.js": "bundle",
    });
    touch(path.join(root, ".next/static/chunks/main.js"), 2_000);
    touch(path.join(root, "next.config.ts"), 2_500);
    expect(buildFreshnessSnapshot(root).stale).toEqual(["next.config.ts"]);
  });
});

describe("runBundleCheck（整条门禁）", () => {
  it("产物过期时先失败，连体积都不报", () => {
    const root = makeRepo({
      "src/app/page.tsx": "broken",
      ".next/static/chunks/main.js": "bundle",
      ".bundle-baseline": "1",
    });
    touch(path.join(root, ".next/static/chunks/main.js"), 2_000);
    touch(path.join(root, "src/app/page.tsx"), 9_000);

    const lines: string[] = [];
    const log = console.log;
    const error = console.error;
    console.log = (...args: unknown[]) => lines.push(args.join(" "));
    console.error = (...args: unknown[]) => lines.push(args.join(" "));
    try {
      expect(runBundleCheck(root)).toBe(1);
    } finally {
      console.log = log;
      console.error = error;
    }
    expect(lines.join("\n")).toContain("构建产物比源码旧");
    expect(lines.join("\n")).not.toContain("Bundle 体积在基线范围内");
  });

  it("产物新鲜且在基线内时通过", () => {
    const root = makeRepo({
      "src/app/page.tsx": "ok",
      ".next/static/chunks/main.js": "x".repeat(2048),
      ".bundle-baseline": "99999",
    });
    touch(path.join(root, "src/app/page.tsx"), 1_000);
    touch(path.join(root, ".next/static/chunks/main.js"), 2_000);
    expect(runBundleCheck(root)).toBe(0);
  });
});
