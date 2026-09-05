"use client";

/**
 * 联系消息页（仅限 admin/super_admin）
 * 展示公开联系表单提交的消息：姓名、邮箱、主题、内容
 */

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { dashboardQueryOptions, CACHE_STALE, QUERY_KEYS } from "@/lib/query-cache";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/shared/query-error-state";
import {
  listContactMessagesPage,
  updateMessageStatus,
  type ContactMessageRecord,
  type MessageStatus,
} from "@/lib/actions/contact-messages";
import { formatRelativeTime } from "@/lib/date";
import { toast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";

const STATUS_VARIANT: Record<string, "secondary" | "warning" | "success"> = {
  new: "secondary",
  in_progress: "warning",
  resolved: "success",
};

export function ContactMessagesPage() {
  const t = useTranslations("admin.messages");
  const ta = useTranslations("actions");
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | MessageStatus>("all");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data, isLoading: loading, isError, refetch } = useQuery(
    dashboardQueryOptions({
    queryKey: QUERY_KEYS.contactMessages({ search, status, page }),
    staleTime: CACHE_STALE.admin,
    queryFn: async (): Promise<{ rows: ContactMessageRecord[]; total: number }> => {
      const result = await listContactMessagesPage({ search, status, page, pageSize });
      if (!result.ok) throw new Error(result.error);
      return result.data ?? { rows: [], total: 0 };
    },
    }));
  const messages = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  // 状态文案静态映射（避免动态 key 触发缺键错误）
  const statusLabel: Record<string, string> = {
    new: t("status.new"),
    in_progress: t("status.inProgress"),
    resolved: t("status.resolved"),
  };

  function changeStatus(id: string, status: MessageStatus) {
    setPendingId(id);
    startTransition(async () => {
      const result = await updateMessageStatus(id, status);
      setPendingId(null);
      if (!result.ok) {
        toast({ title: ta(result.error), variant: "destructive" });
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ["contact-messages"] });
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("desc")}</p>
      </div>

      <form onSubmit={submitSearch} className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="sm:max-w-xs"
          aria-label={t("searchPlaceholder")}
        />
        <div className="flex gap-2">
          {(
            [
              ["all", t("filterAll")],
              ["new", t("status.new")],
              ["in_progress", t("status.inProgress")],
              ["resolved", t("status.resolved")],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              type="button"
              variant={status === value ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setStatus(value);
                setPage(1);
              }}
            >
              {label}
            </Button>
          ))}
          <Button type="submit" size="sm">
            {t("search")}
          </Button>
        </div>
      </form>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : isError ? (
            <QueryErrorState onRetry={() => void refetch()} />
          ) : messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("noMessages")}
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {t("total", { count: total })}
              </p>
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className="space-y-2 rounded-md border p-4"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{t("subject")}</Badge>
                      <span className="font-medium">{msg.subject}</span>
                    </div>
                    <time className="shrink-0 text-xs text-muted-foreground">
                      {formatRelativeTime(msg.created_at)}
                    </time>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{msg.name}</span>
                    <span>·</span>
                    <a
                      href={`mailto:${msg.email}`}
                      className="text-primary hover:underline"
                    >
                      {msg.email}
                    </a>
                    <span>·</span>
                    <Badge variant={STATUS_VARIANT[msg.status] ?? "secondary"}>
                      {statusLabel[msg.status] ?? msg.status}
                    </Badge>
                  </div>
                  <p className="whitespace-pre-wrap text-sm">{msg.message}</p>
                  {msg.status !== "resolved" && (
                    <div className="flex gap-2 pt-1">
                      {msg.status === "new" && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={pendingId === msg.id}
                          onClick={() => changeStatus(msg.id, "in_progress")}
                        >
                          {t("startProcess")}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={pendingId === msg.id}
                        onClick={() => changeStatus(msg.id, "resolved")}
                      >
                        {t("resolve")}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <p className="text-xs text-muted-foreground">
                    {t("pageOf", { page, totalPages })}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      {t("prev")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      {t("next")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
