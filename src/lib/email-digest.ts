/**
 * 摘要邮件正文折叠规则（v0.5.0 A01）
 * 同类型通知达到折叠阈值时合并计数，明细条目超过上限时溢出计数，
 * 避免 digest 正文随队列线性膨胀。
 */
import type { Notification, NotificationType } from "@/lib/repositories/notifications";

/** 类型 → 中文标签（邮件正文当前为中文，与邮件主题一致） */
export const EMAIL_TYPE_LABELS: Record<NotificationType, string> = {
  system: "系统",
  team_invite: "团队邀请",
  role_changed: "角色变更",
  payment_succeeded: "支付成功",
  billing_update: "账单更新",
  deployment: "部署",
  security_alert: "安全告警",
};

/** 明细条目上限：超过后只计总数不展开 */
export const DIGEST_MAX_ITEMS = 5;
/** 同类型折叠阈值：达到该条数合并为一行 */
export const DIGEST_FOLD_THRESHOLD = 3;
/** digest 本地发送时刻（小时） */
export const DIGEST_LOCAL_HOUR = 8;
/** 用户未配置时区时的回退时区（UTC+8，与首版文档声明一致） */
export const DIGEST_DEFAULT_TIMEZONE = "Asia/Shanghai";

export type DigestEntry =
  | { kind: "item"; title: string; body: string }
  | { kind: "folded"; label: string; count: number };

export interface DigestFoldResult {
  entries: DigestEntry[];
  /** 未展开的明细条数（不含折叠行） */
  overflow: number;
}

/**
 * 按类型分组折叠：≥阈值合并为"N 条 ×类型"；其余逐条展开，明细最多 MAX 条。
 * 输入顺序（created_at 正序）保留在分组的先后顺序里。
 */
export function foldDigestNotifications(notifications: Notification[]): DigestFoldResult {
  // database.types 中 notifications.type 生成为 string，分组键用 string，标签查找时收窄
  const groups = new Map<string, Notification[]>();
  for (const n of notifications) {
    const arr = groups.get(n.type) ?? [];
    arr.push(n);
    groups.set(n.type, arr);
  }

  const entries: DigestEntry[] = [];
  let itemCount = 0;
  let overflow = 0;
  for (const [type, items] of groups) {
    if (items.length >= DIGEST_FOLD_THRESHOLD) {
      entries.push({ kind: "folded", label: EMAIL_TYPE_LABELS[type as NotificationType] ?? type, count: items.length });
      continue;
    }
    for (const n of items) {
      if (itemCount >= DIGEST_MAX_ITEMS) {
        overflow += 1;
        continue;
      }
      itemCount += 1;
      entries.push({ kind: "item", title: n.title, body: n.body ?? "" });
    }
  }
  return { entries, overflow };
}

/**
 * 某时区在给定时刻的本地小时（0-23）。
 * 部分运行时午夜会格式化为 "24"，取模归一。
 * 时区标识非法时 Intl 抛错，由调用方处理。
 */
export function localHourInTimeZone(timeZone: string, date: Date): number {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
  }).format(date);
  return Number(formatted) % 24;
}

/**
 * digest 错峰门控（v0.5.0 A04）：该用户此刻是否处于本地发送小时。
 * 时区为空回退 DIGEST_DEFAULT_TIMEZONE；非法时区同样回退，不让坏数据静默丢弃邮件。
 */
export function isDigestHour(timezone: string | null | undefined, now: Date): boolean {
  const tz = timezone?.trim() || DIGEST_DEFAULT_TIMEZONE;
  try {
    return localHourInTimeZone(tz, now) === DIGEST_LOCAL_HOUR;
  } catch {
    return localHourInTimeZone(DIGEST_DEFAULT_TIMEZONE, now) === DIGEST_LOCAL_HOUR;
  }
}
