"use client";

/**
 * 联系消息页（仅限 admin/super_admin）
 * 展示公开联系表单提交的消息：姓名、邮箱、主题、内容
 */

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/shared/query-error-state";
import { listContactMessages, type ContactMessageRecord } from "@/lib/actions/contact-messages";
import { formatRelativeTime } from "@/lib/date";

export function ContactMessagesPage() {
  const t = useTranslations("admin.messages");

  const { data: messages = [], isLoading: loading, isError, refetch } = useQuery({
    queryKey: ["contact-messages"],
    queryFn: async (): Promise<ContactMessageRecord[]> => {
      const result = await listContactMessages(100);
      if (!result.ok) throw new Error(result.error);
      return result.data ?? [];
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("desc")}</p>
      </div>

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
                  </div>
                  <p className="whitespace-pre-wrap text-sm">{msg.message}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
