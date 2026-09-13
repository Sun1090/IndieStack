"use client";

/**
 * 未读通知数量：60s 轮询 + 切回前台刷新（D04 实时策略）。
 * 桌面侧边栏与移动端抽屉共用同一 query key，react-query 自动去重。
 */
import { useQuery } from "@tanstack/react-query";
import { useUser } from "@/hooks/use-user";
import { CACHE_STALE, dashboardQueryOptions, QUERY_KEYS } from "@/lib/query-cache";
import { getUnreadNotificationCount } from "@/lib/actions/notifications";

export function useUnreadNotificationCount(): number {
  const { user } = useUser();
  const { data = 0 } = useQuery(
    dashboardQueryOptions({
      queryKey: QUERY_KEYS.unreadCount,
      staleTime: CACHE_STALE.live,
      enabled: Boolean(user),
      refetchInterval: 60_000,
      refetchOnWindowFocus: true,
      queryFn: async () => {
        const result = await getUnreadNotificationCount();
        if (!result.ok) throw new Error(result.error);
        return result.data?.unread ?? 0;
      },
    }),
  );

  return data;
}
