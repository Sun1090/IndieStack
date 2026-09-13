"use client";

/**
 * 数据错误重试卡片
 * TanStack Query 查询失败时展示，提供重试按钮（替代裸错误文本）
 *
 * G04 起展示层下沉到 `error-state.tsx`，这里只负责客户端重试交互与默认文案。
 */

import { useTranslations } from "next-intl";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/shared/error-state";

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
    <ErrorState
      className={className}
      description={message ?? t("error")}
      action={
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("retry")}
        </Button>
      }
    />
  );
}
