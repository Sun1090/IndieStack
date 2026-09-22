"use client";

/**
 * 全部标为已读按钮
 * 调用 Server Action 批量更新，成功与失败都要 toast（页面经 revalidatePath 自动刷新）：
 * 失败时什么都不说，用户看到的就是「点了、没反应」，只能反复点。
 */

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markAllNotificationsRead } from "@/lib/actions/notifications";
import { toast } from "@/hooks/use-toast";

interface MarkAllReadButtonProps {
  unreadCount: number;
}

export function MarkAllReadButton({ unreadCount }: MarkAllReadButtonProps) {
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");
  const ta = useTranslations("actions");
  const [pending, startTransition] = useTransition();

  if (unreadCount === 0) return null;

  function handleClick() {
    startTransition(async () => {
      const result = await markAllNotificationsRead();
      if (result.ok) {
        toast({ title: t("notifications.list.markAllRead") });
      } else {
        toast({ title: tc("error"), description: ta(result.error), variant: "destructive" });
      }
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={pending}>
      <CheckCheck className="me-2 h-4 w-4" />
      {pending ? "..." : t("notifications.list.markAllRead")}
    </Button>
  );
}
