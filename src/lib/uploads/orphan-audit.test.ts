import { describe, expect, it } from "vitest";
import {
  ORPHAN_AUDIT_RPC,
  OrphanAuditError,
  decideOrphanExitCode,
  formatBytes,
  formatOrphanReport,
  parseOrphanRows,
  summarizeOrphans,
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

  it("零孤儿也要留下可归档的说明", () => {
    const lines = formatOrphanReport([], summarizeOrphans([], NOW), { nowMs: NOW });
    expect(lines[0]).toContain("孤儿对象：0 条");
    expect(lines.join("\n")).toContain("provider 侧 list() 差集");
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
