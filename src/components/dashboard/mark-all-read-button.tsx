"use client";

/**
 * 全部标为已读按钮
 * 调用 Server Action 批量更新，成功后 toast 提示（页面经 revalidatePath 自动刷新）
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
  const [pending, startTransition] = useTransition();

  if (unreadCount === 0) return null;

  function handleClick() {
    startTransition(async () => {
      const result = await markAllNotificationsRead();
      if (result.ok) {
        toast({ title: t("notifications.list.markAllRead") });
      }
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={pending}>
      <CheckCheck className="mr-2 h-4 w-4" />
      {pending ? "..." : t("notifications.list.markAllRead")}
    </Button>
  );
}
