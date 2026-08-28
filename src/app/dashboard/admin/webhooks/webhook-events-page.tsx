"use client";

/**
 * Webhook 事件日志页（仅限 super_admin）
 * 展示 Stripe webhook 处理历史：事件类型、状态、错误信息
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/shared/query-error-state";
import { RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { listWebhookEvents, type WebhookEventRecord } from "@/lib/actions/webhooks";

const statusVariant = {
  processed: "success",
  skipped: "secondary",
  failed: "destructive",
  received: "outline",
} as const;

export function WebhookEventsPage() {
  const t = useTranslations("admin");
  const ta = useTranslations("actions");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [autoRefresh, setAutoRefresh] = useState(false);

  const { data: events = [], isLoading: loading, isError, refetch } = useQuery({
    refetchInterval: autoRefresh ? 10_000 : false,
    queryKey: ["webhook-events"],
    queryFn: async (): Promise<WebhookEventRecord[]> => {
      const result = await listWebhookEvents(100);
      if (!result.ok) throw new Error(result.error);
      return result.data ?? [];
    },
  });

  const filtered =
    statusFilter === "all" ? events : events.filter((e) => e.status === statusFilter);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("webhookLogs.title")}</h1>
          <p className="text-muted-foreground">{t("webhookLogs.desc")}</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="h-4 w-4"
          />
          {t("webhookLogs.autoRefresh")}
        </label>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {t("auditLogs.refresh")}
        </Button>
      </div>

      {/* 状态筛选 */}
      <div className="flex flex-wrap gap-2">
        {["all", "processed", "skipped", "failed"].map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter(s)}
          >
            {s}
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : isError ? (
            <QueryErrorState onRetry={() => void refetch()} />
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("webhookLogs.noLogs")}
            </p>
          ) : (
            <div className="space-y-2">
              {filtered.map((event) => (
                <div
                  key={event.id}
                  className="flex items-center justify-between gap-4 rounded-md border p-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={statusVariant[event.status as keyof typeof statusVariant] ?? "outline"}>
                        {event.status}
                      </Badge>
                      <span className="font-mono text-xs text-muted-foreground">
                        {event.event_type}
                      </span>
                    </div>
<details className="min-w-0">
                      <summary className="cursor-pointer truncate font-mono text-xs text-muted-foreground">
                        {event.event_id}
                      </summary>
                      {event.payload && Object.keys(event.payload).length > 0 && (
                        <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 text-[10px]">
                          {JSON.stringify(event.payload, null, 2)}
                        </pre>
                      )}
                    </details>
                    {event.error_message && (
                      <p className="text-xs text-destructive">{event.error_message}</p>
                    )}
                  </div>
                  <time className="shrink-0 text-xs text-muted-foreground">
                    {new Date(event.created_at).toLocaleString()}
                  </time>
                </div>
              ))}
            </div>
          )}
          {!loading && filtered.length > 0 && (
            <p className="mt-4 text-center text-xs text-muted-foreground">
              {ta("loadedAt")} {new Date().toLocaleTimeString()}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
