"use client";

/**
 * 通知中心实时刷新（v0.6.0 G09）
 *
 * 订阅当前用户 notifications INSERT 事件，收到后合并刷新页面数据。
 * Realtime 未配置或连接失败时只显示降级状态，不影响服务端渲染的通知列表。
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

const REFRESH_DEBOUNCE_MS = 120;

type RealtimeStatus = "connecting" | "live" | "offline";
type ChannelSubscription = { unsubscribe: () => Promise<unknown> | unknown };

interface NotificationsLiveProps {
  userId: string;
}

export function NotificationsLive({ userId }: NotificationsLiveProps) {
  const router = useRouter();
  const t = useTranslations("dashboard.notifications.list");
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let disposed = false;
    let channel: ChannelSubscription | null = null;
    let removeChannel: ((channel: ChannelSubscription) => Promise<unknown>) | null = null;

    const scheduleRefresh = () => {
      if (refreshTimerRef.current) return;
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        router.refresh();
      }, REFRESH_DEBOUNCE_MS);
    };

    try {
      const supabase = createClient();
      removeChannel = supabase.removeChannel?.bind(supabase) ?? null;
      channel = supabase
        .channel(`notifications:${userId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`,
          },
          scheduleRefresh,
        )
        .subscribe((nextStatus: string) => {
          if (disposed) return;
          if (nextStatus === "SUBSCRIBED") {
            setStatus("live");
            return;
          }
          if (
            nextStatus === "CHANNEL_ERROR" ||
            nextStatus === "TIMED_OUT" ||
            nextStatus === "CLOSED"
          ) {
            setStatus("offline");
          }
        });
    } catch (error) {
      console.warn("[NotificationsLive] Realtime 订阅初始化失败，已安全降级:", error);
      queueMicrotask(() => {
        if (!disposed) setStatus("offline");
      });
    }

    return () => {
      disposed = true;
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      if (!channel) return;
      if (removeChannel) {
        void removeChannel(channel).catch(() => undefined);
        return;
      }
      void Promise.resolve(channel.unsubscribe()).catch(() => undefined);
    };
  }, [router, userId]);

  const label = t(status === "live" ? "live" : status === "offline" ? "offline" : "connecting");

  return (
    <span
      role="status"
      aria-live="polite"
      className="text-muted-foreground inline-flex items-center gap-1.5 text-xs"
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2 rounded-full",
          status === "live" && "bg-emerald-500",
          status === "connecting" && "animate-pulse bg-amber-500",
          status === "offline" && "bg-muted-foreground/50",
        )}
      />
      {label}
    </span>
  );
}
