"use client";

/**
 * 单条通知"标记已读"点击区
 * 未读通知点击圆点/标题即调用 Action 标记已读
 */

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { markNotificationRead } from "@/lib/actions/notifications";

interface MarkReadActionProps {
  notificationId: string;
}

export function MarkReadAction({ notificationId }: MarkReadActionProps) {
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  if (done) return <Check className="h-3.5 w-3.5 text-muted-foreground" aria-label="read" />;

  return (
    <button
      type="button"
      title="Mark as read"
      disabled={pending}
      className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      onClick={() =>
        startTransition(async () => {
          const result = await markNotificationRead(notificationId);
          if (result.ok) setDone(true);
        })
      }
    >
      {pending ? (
        <span className="block h-2 w-2 animate-pulse rounded-full bg-primary/50" />
      ) : (
        <span className="block h-2 w-2 rounded-full bg-primary" />
      )}
    </button>
  );
}
