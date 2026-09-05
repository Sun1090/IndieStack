/**
 * email-digest 折叠规则单测（v0.5.0 A01）
 * 覆盖：同类型折叠阈值、明细截断上限、溢出计数、分组顺序保留
 */
import { describe, it, expect } from "vitest";
import {
  foldDigestNotifications,
  isDigestHour,
  localHourInTimeZone,
  DIGEST_MAX_ITEMS,
  EMAIL_TYPE_LABELS,
} from "./email-digest";
import type { Notification } from "@/lib/repositories/notifications";

function notif(id: string, type: Notification["type"], title = id, body: string | null = null): Notification {
  return {
    id,
    user_id: "u1",
    type,
    title,
    body,
    created_at: "2026-01-01",
    is_read: false,
    email_sent: false,
    link: null,
    metadata: null,
  } as Notification;
}

describe("foldDigestNotifications()", () => {
  it("同类型达到折叠阈值时合并为一行计数", () => {
    const result = foldDigestNotifications([
      notif("d1", "deployment"),
      notif("d2", "deployment"),
      notif("d3", "deployment"),
    ]);
    expect(result.entries).toEqual([{ kind: "folded", label: "部署", count: 3 }]);
    expect(result.overflow).toBe(0);
  });

  it("低于阈值的同类型通知逐条展开", () => {
    const result = foldDigestNotifications([notif("s1", "system", "S1"), notif("s2", "system", "S2")]);
    expect(result.entries).toEqual([
      { kind: "item", title: "S1", body: "" },
      { kind: "item", title: "S2", body: "" },
    ]);
  });

  it("明细超过上限时截断并计入溢出（多个低于阈值的小分组合计超限）", () => {
    const items = [
      notif("a1", "system"),
      notif("a2", "system"),
      notif("b1", "deployment"),
      notif("b2", "deployment"),
      notif("c1", "billing_update"),
      notif("c2", "billing_update"),
    ];
    const result = foldDigestNotifications(items);
    const itemEntries = result.entries.filter((e) => e.kind === "item");
    expect(itemEntries).toHaveLength(DIGEST_MAX_ITEMS);
    expect(result.overflow).toBe(1);
  });

  it("折叠行不计入明细上限", () => {
    const deploys = [notif("d1", "deployment"), notif("d2", "deployment"), notif("d3", "deployment")];
    const small = [
      notif("s1", "system"),
      notif("s2", "system"),
      notif("t1", "team_invite"),
      notif("t2", "team_invite"),
      notif("b1", "billing_update"),
      notif("b2", "billing_update"),
    ];
    const result = foldDigestNotifications([...deploys, ...small]);
    expect(result.entries[0]).toEqual({ kind: "folded", label: "部署", count: 3 });
    expect(result.entries.filter((e) => e.kind === "item")).toHaveLength(DIGEST_MAX_ITEMS);
    expect(result.overflow).toBe(1);
  });

  it("分组顺序按首次出现顺序保留", () => {
    const result = foldDigestNotifications([
      notif("a1", "system"),
      notif("b1", "security_alert"),
      notif("a2", "system"),
      notif("b2", "security_alert"),
      notif("a3", "system"),
    ]);
    expect(result.entries).toEqual([
      { kind: "folded", label: EMAIL_TYPE_LABELS.system, count: 3 },
      { kind: "item", title: "b1", body: "" },
      { kind: "item", title: "b2", body: "" },
    ]);
  });

  it("空输入返回空结果", () => {
    expect(foldDigestNotifications([])).toEqual({ entries: [], overflow: 0 });
  });

  it("条目携带 body", () => {
    const result = foldDigestNotifications([notif("s1", "system", "标题", "正文")]);
    expect(result.entries).toEqual([{ kind: "item", title: "标题", body: "正文" }]);
  });
});

describe("localHourInTimeZone()", () => {
  const utcMidnight = new Date("2026-01-01T00:00:00Z");

  it("按 IANA 时区解析本地小时", () => {
    expect(localHourInTimeZone("Asia/Shanghai", utcMidnight)).toBe(8);
    expect(localHourInTimeZone("UTC", utcMidnight)).toBe(0);
    expect(localHourInTimeZone("America/New_York", utcMidnight)).toBe(19);
  });
});

describe("isDigestHour()", () => {
  const shanghaiEight = new Date("2026-01-01T00:00:00Z");
  const shanghaiNine = new Date("2026-01-01T01:00:00Z");

  it("空时区回退默认时区（UTC+8）", () => {
    expect(isDigestHour(null, shanghaiEight)).toBe(true);
    expect(isDigestHour(undefined, shanghaiEight)).toBe(true);
    expect(isDigestHour("  ", shanghaiEight)).toBe(true);
  });

  it("用户时区本地到达发送小时才放行", () => {
    expect(isDigestHour("Asia/Shanghai", shanghaiEight)).toBe(true);
    expect(isDigestHour("Asia/Shanghai", shanghaiNine)).toBe(false);
    expect(isDigestHour("America/New_York", shanghaiEight)).toBe(false);
  });

  it("非法时区回退默认时区而非静默丢弃", () => {
    expect(isDigestHour("Not/AZone", shanghaiEight)).toBe(true);
  });
});
