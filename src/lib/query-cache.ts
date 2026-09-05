/**
 * TanStack Query 缓存策略收口（v0.5.0 E02）
 * - QUERY_KEYS：全站 query key 单一来源（查询与 invalidate 共用，杜绝魔法字符串漂移）
 * - dashboardQueryOptions：统一 staleTime/gcTime/retry/refetchOnWindowFocus 约定，
 *   页面只声明 key、fetcher 与必要的覆盖项。
 *
 * 缓存档位：
 *   live     —— 轮询型指标（未读数、webhook 自动刷新），可接受短缓存
 *   standard —— 普通业务列表/详情（默认）
 *   admin    —— 管理端列表（数据敏感度略高，缓存更短）
 */
import { queryOptions, type QueryKey } from "@tanstack/react-query";

export const QUERY_KEYS = {
  unreadCount: ["unread-count"],
  apiKeys: ["api-keys"],
  analytics: (range: string | number): QueryKey => ["analytics", range],
  mfaFactors: ["mfa-factors"],
  recoveryStatus: ["recovery-status"],
  adminUsers: ["admin-users"],
  adminAuditLogs: ["audit-logs"],
  adminWebhookEvents: ["webhook-events"],
  contactMessages: (filters: { search: string; status: string; page: number }): QueryKey => [
    "contact-messages",
    filters,
  ],
} as const;

export const CACHE_STALE = {
  live: 10_000,
  standard: 30_000,
  admin: 15_000,
} as const;

interface DashboardQueryOptionsInput<T> {
  queryKey: QueryKey;
  queryFn: () => Promise<T>;
  /** 覆盖默认档位（默认 standard 30s） */
  staleTime?: number;
  /** 轮询间隔（毫秒）；false 显式关闭 */
  refetchInterval?: number | false;
  /** 条件启用（如依赖 user 状态） */
  enabled?: boolean;
  /** 覆盖默认的窗口聚焦刷新（默认关闭） */
  refetchOnWindowFocus?: boolean;
}

/** 仪表盘/管理端查询的统一 queryOptions 工厂 */
export function dashboardQueryOptions<T>({
  queryKey,
  queryFn,
  staleTime = CACHE_STALE.standard,
  refetchInterval,
  enabled,
  refetchOnWindowFocus = false,
}: DashboardQueryOptionsInput<T>) {
  return queryOptions({
    queryKey,
    queryFn,
    staleTime,
    gcTime: 5 * 60_000,
    retry: 1,
    refetchOnWindowFocus,
    ...(refetchInterval !== undefined ? { refetchInterval } : {}),
    ...(enabled !== undefined ? { enabled } : {}),
  });
}
