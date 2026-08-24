"use client";

/**
 * 数据错误重试卡片
 * TanStack Query 查询失败时展示，提供重试按钮（替代裸错误文本）
 */

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { AlertCircle, RotateCcw } from "lucide-react";

interface QueryErrorStateProps {
  /** 重试回调（通常是 refetch） */
  onRetry: () => void;
  /** 可选：自定义提示文案（已翻译） */
  message?: string;
  /** 卡片高度类名，与骨架屏一致以减少布局跳动 */
  className?: string;
}

export function QueryErrorState({ onRetry, message, className }: QueryErrorStateProps) {
  const t = useTranslations("common");

  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center gap-3 py-10 text-center ${className ?? ""}`}
    >
      <AlertCircle className="h-8 w-8 text-destructive/70" />
      <p className="text-sm text-muted-foreground">{message ?? t("error")}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCcw className="mr-2 h-4 w-4" />
        {t("retry")}
      </Button>
    </div>
  );
}
