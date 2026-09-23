import { describe, expect, it } from "vitest";
import {
  ORPHAN_AUDIT_RPC,
  OrphanAuditError,
  decideOrphanExitCode,
  diffProviderObjects,
  formatBytes,
  formatOrphanReport,
  formatProviderDiffLines,
  parseOrphanRows,
  parseStorageListPage,
  providerDiffFindings,
  summarizeOrphans,
  walkProviderBucket,
  type OrphanObjectRow,
} from "./orphan-audit";

const NOW = Date.parse("2026-09-22T00:00:00.000Z");
const DAY = 86_400_000;

function row(overrides: Partial<OrphanObjectRow> & Record<string, unknown> = {}) {
  return {
    bucket: "avatars",
    object_key: "user-1/portrait.png",
    owner_id: "user-1",
    byte_size: 2048,
    created_at: new Date(NOW - 3 * DAY).toISOString(),
    ...overrides,
  };
}

describe("parseOrphanRows()", () => {
  it("把 RPC 行转成结构化结果", () => {
    const [parsed] = parseOrphanRows([row()]);
    expect(parsed).toEqual({
      bucket: "avatars",
      objectKey: "user-1/portrait.png",
      ownerId: "user-1",
      byteSize: 2048,
      createdAt: new Date(NOW - 3 * DAY).toISOString(),
    });
  });

  it("owner_id 为 null 表示账户已删除", () => {
    expect(parseOrphanRows([row({ owner_id: null })])[0]?.ownerId).toBeNull();
  });

  it("接受 PostgREST 以字符串序列化的 bigint", () => {
    expect(parseOrphanRows([row({ byte_size: "4096" })])[0]?.byteSize).toBe(4096);
  });

  it("非数组、缺列、坏类型都抛错而不是报成零孤儿", () => {
    expect(() => parseOrphanRows(null)).toThrow(OrphanAuditError);
    expect(() => parseOrphanRows({})).toThrow(/期望数组/);
    expect(() => parseOrphanRows([row({ object_key: "" })])).toThrow(/object_key/);
    expect(() => parseOrphanRows([row({ byte_size: -1 })])).toThrow(/byte_size 非法/);
    expect(() => parseOrphanRows([row({ owner_id: 42 })])).toThrow(/owner_id 类型非法/);
    expect(() => parseOrphanRows(["nope"])).toThrow(/不是对象/);
  });
});

describe("summarizeOrphans()", () => {
  const rows = parseOrphanRows([
    row({ owner_id: null, byte_size: 8192 }),
    row({ bucket: "covers", object_key: "team/bg.png", owner_id: "user-2", byte_size: 1024 }),
    row({ created_at: new Date(NOW - 40 * DAY).toISOString(), byte_size: 512 }),
  ]);

  it("统计总数、体积与「账户已删除」单列", () => {
    const summary = summarizeOrphans(rows, NOW);
    expect(summary.count).toBe(3);
    expect(summary.totalBytes).toBe(9728);
    expect(summary.unowned).toBe(1);
    expect(summary.unownedBytes).toBe(8192);
    expect(summary.oldestDays).toBe(40);
  });

  it("按 bucket 汇总并按体积降序", () => {
    expect(summarizeOrphans(rows, NOW).byBucket).toEqual([
      { bucket: "avatars", count: 2, bytes: 8704 },
      { bucket: "covers", count: 1, bytes: 1024 },
    ]);
  });

  it("空清单不产生伪计数", () => {
    expect(summarizeOrphans([], NOW)).toEqual({
      count: 0,
      totalBytes: 0,
      unowned: 0,
      unownedBytes: 0,
      byBucket: [],
      oldestDays: null,
    });
  });
});

describe("报告与退出码", () => {
  it("报告点明账户已删除的条数与 provider 侧盲区", () => {
    const rows = parseOrphanRows([row({ owner_id: null })]);
    const lines = formatOrphanReport(rows, summarizeOrphans(rows, NOW), { nowMs: NOW });
    expect(lines.join("\n")).toContain("1 条上传者账户已删除");
    expect(lines.join("\n")).toContain("账户已删除");
    expect(lines.join("\n")).toContain("bucket avatars: 1 条");
  });

  it("零孤儿也要留下可归档的说明，并且不许把「没列目录」说成「没有存量」", () => {
    const lines = formatOrphanReport([], summarizeOrphans([], NOW), { nowMs: NOW });
    expect(lines[0]).toContain("孤儿对象：0 条");
    // 不带 --provider-diff 时这一趟只查了数据库侧，报告必须自己讲清这个边界。
    expect(lines.join("\n")).toContain("--provider-diff");
    expect(lines.join("\n")).toContain("从未落过元数据");
  });

  it("明细超出上限时提示改用 --json", () => {
    const rows = parseOrphanRows(Array.from({ length: 3 }, () => row()));
    const lines = formatOrphanReport(rows, summarizeOrphans(rows, NOW), { nowMs: NOW, maxRows: 2 });
    expect(lines.join("\n")).toContain("另有 1 条");
  });

  it("默认不因发现孤儿而失败，--fail-on-findings 才返回 2", () => {
    const rows = parseOrphanRows([row()]);
    const summary = summarizeOrphans(rows, NOW);
    expect(decideOrphanExitCode(summary, false)).toBe(0);
    expect(decideOrphanExitCode(summary, true)).toBe(2);
    expect(decideOrphanExitCode(summarizeOrphans([], NOW), true)).toBe(0);
  });

  it("字节单位换算", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KiB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.0 GiB");
  });

  it("RPC 名与迁移签名一致", () => {
    expect(ORPHAN_AUDIT_RPC).toBe("find_orphan_upload_objects");
  });
});

// 以下两条列目录返回的形状取自本地栈实测（2026-09-23）：
// 文件夹 `{"name":"probe","id":null,"metadata":null,…}`，
// 对象 `{"name":"orphan-probe.txt","id":"<uuid>","updated_at":"…","metadata":{"size":12,…}}`。
const ISO = "2026-09-23T00:39:55.257Z";

function file(name: string, bytes = 12) {
  return {
    name,
    id: "22d3001f-cb76-411d-a608-53851ed84139",
    updated_at: ISO,
    created_at: ISO,
    last_accessed_at: ISO,
    metadata: { size: bytes, mimetype: "text/plain" },
  };
}

function folder(name: string) {
  return { name, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null };
}

describe("parseStorageListPage()", () => {
  it("按实测形状解析对象与文件夹", () => {
    expect(parseStorageListPage([file("a.txt", 12), folder("u1")], "avatars/")).toEqual([
      { name: "a.txt", id: "22d3001f-cb76-411d-a608-53851ed84139", updatedAt: ISO, bytes: 12 },
      { name: "u1", id: null, updatedAt: null, bytes: null },
    ]);
  });

  it("不认识的形状一律抛错，不猜成「没有对象」", () => {
    expect(() => parseStorageListPage(null, "")).toThrow(/期望数组/);
    expect(() => parseStorageListPage(["x"], "")).toThrow(/不是对象/);
    expect(() => parseStorageListPage([{ id: "x" }], "")).toThrow(/缺少 name/);
    expect(() => parseStorageListPage([{ name: "a", id: 7 }], "")).toThrow(/id 类型非法/);
    expect(() => parseStorageListPage([{ name: "a", metadata: "size=1" }], "")).toThrow(
      /metadata 类型非法/,
    );
    expect(() => parseStorageListPage([{ name: "a", metadata: { size: -1 } }], "")).toThrow(
      /metadata.size 非法/,
    );
  });

  it("缺 updated_at 或 metadata 的对象仍可解析（字节数未知不等于不存在）", () => {
    expect(parseStorageListPage([{ name: "a", id: "x" }], "")).toEqual([
      { name: "a", id: "x", updatedAt: null, bytes: null },
    ]);
  });
});

describe("walkProviderBucket()", () => {
  /** 一棵两层的假目录树：根下 1 个文件夹 + 2 个对象，文件夹里 1 个对象。 */
  function tree() {
    const calls: Array<{ prefix: string; offset: number }> = [];
    const pages: Record<string, unknown[]> = {
      "": [folder("u1"), file("root.png", 100)],
      "u1/": [file("avatar.png", 2048)],
    };
    const listPage = async (prefix: string, offset: number) => {
      calls.push({ prefix, offset });
      return pages[prefix] ?? [];
    };
    return { calls, listPage };
  }

  it("递归进文件夹并拼出完整对象键", async () => {
    const { calls, listPage } = tree();
    const walked = await walkProviderBucket({ bucket: "avatars", listPage });
    expect(walked.objects.map((o) => o.objectKey)).toEqual(["root.png", "u1/avatar.png"]);
    expect(walked.objects[1]).toEqual({
      bucket: "avatars",
      objectKey: "u1/avatar.png",
      bytes: 2048,
      updatedAt: ISO,
    });
    expect(walked.folders).toBe(1);
    expect(walked.complete).toBe(true);
    expect(calls).toEqual([
      { prefix: "", offset: 0 },
      { prefix: "u1/", offset: 0 },
    ]);
  });

  it("整页时继续翻页，短页才算结束", async () => {
    const seen: number[] = [];
    const walked = await walkProviderBucket({
      bucket: "avatars",
      listPage: async (_prefix, offset) => {
        seen.push(offset);
        return offset === 0 ? [file("a"), file("b")] : [file("c")];
      },
      limits: { pageSize: 2 },
    });
    expect(seen).toEqual([0, 2]);
    expect(walked.objects).toHaveLength(3);
    expect(walked.pages).toBe(2);
  });

  it("页数触顶 = 清单不完整，并且记住停在哪", async () => {
    const walked = await walkProviderBucket({
      bucket: "avatars",
      listPage: async () => Array.from({ length: 2 }, (_, i) => file(`f${i}`)),
      limits: { pageSize: 2, maxPages: 3 },
    });
    expect(walked.complete).toBe(false);
    expect(walked.pages).toBe(3);
    expect(walked.stoppedAt).toContain("页数上限");
  });

  it("深度与条数触顶同样算不完整", async () => {
    const deep = await walkProviderBucket({
      bucket: "avatars",
      listPage: async (prefix) => (prefix === "" ? [folder("a")] : prefix.split("/").length > 2 ? [] : [folder("b")]),
      limits: { maxDepth: 1 },
    });
    expect(deep.complete).toBe(false);
    expect(deep.stoppedAt).toContain("深度上限");

    const many = await walkProviderBucket({
      bucket: "avatars",
      listPage: async () => Array.from({ length: 5 }, (_, i) => file(`f${i}`)),
      limits: { pageSize: 5, maxObjects: 3 },
    });
    expect(many.complete).toBe(false);
    expect(many.stoppedAt).toContain("条数上限");
  });

  it("同一棵树里重复出现的键只记一次", async () => {
    const walked = await walkProviderBucket({
      bucket: "avatars",
      listPage: async (prefix) => (prefix === "" ? [file("a"), file("a")] : []),
    });
    expect(walked.objects).toHaveLength(1);
  });
});

describe("diffProviderObjects()", () => {
  // 三个对象：`known` 有元数据、`legacy*` 完全没有；元数据里 `gone` 是 active 但对象已经不在。
  const objects = [
    { bucket: "avatars", objectKey: "known.png", bytes: 1, updatedAt: ISO },
    { bucket: "avatars", objectKey: "legacy.png", bytes: 2, updatedAt: ISO },
    { bucket: "avatars", objectKey: "legacy2.png", bytes: 3, updatedAt: ISO },
  ];
  const tracked = [
    { bucket: "avatars", objectKey: "known.png", status: "active" as const },
    { bucket: "avatars", objectKey: "gone.png", status: "active" as const },
    { bucket: "avatars", objectKey: "tombstone.png", status: "deleted" as const },
    { bucket: "covers", objectKey: "bg.png", status: "active" as const },
  ];
  const diff = diffProviderObjects(
    { bucket: "avatars", objects, pages: 1, folders: 0, complete: true, stoppedAt: null },
    tracked,
  );

  it("provider 有、元数据不认得的是 untracked", () => {
    expect(diff.untracked.map((o) => o.objectKey)).toEqual(["legacy.png", "legacy2.png"]);
  });

  it("元数据 active、对象却不在的是 vanished；deleted 行不算发现", () => {
    expect(diff.vanished).toEqual(["avatars/gone.png"]);
  });

  it("计数只按本 bucket 算，别的 bucket 的行不参与", () => {
    expect(diff.providerCount).toBe(3);
    expect(diff.trackedCount).toBe(3);
    expect(diff.trackedCount).not.toBe(tracked.length);
  });

  it("发现数与退出码：集合差发现也能让 --fail-on-findings 变红", () => {
    expect(providerDiffFindings(diff)).toBe(3);
    const empty = summarizeOrphans([], NOW);
    expect(decideOrphanExitCode(empty, true, providerDiffFindings(diff))).toBe(2);
    expect(decideOrphanExitCode(empty, false, providerDiffFindings(diff))).toBe(0);
    expect(decideOrphanExitCode(empty, true, 0)).toBe(0);
  });

  it("报告文本把两侧数字都写出来，并提示未列全的截断", () => {
    const text = formatProviderDiffLines(diff, 1).join("\n");
    expect(text).toContain("无元数据行");
    expect(text).toContain("1 个");
    expect(text).toContain("avatars/gone.png");
    expect(text).toContain("另有 1 个");
  });
});
