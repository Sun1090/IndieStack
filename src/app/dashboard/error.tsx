/**
 * 仪表盘错误边界
 * 捕获仪表盘子页面的渲染错误并提供友好的错误提示和重试按钮
 * 展示层走共享 ErrorState（G04），与全站错误页保持一致
 */
"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/shared/error-state";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");

  useEffect(() => {
    console.error("仪表盘渲染错误:", error);
  }, [error]);

  return (
    <ErrorState
      size="page"
      title={t("errorBoundary.title")}
      description={
        <>
          <p>{t("errorBoundary.desc")}</p>
          {error.digest && (
            <p className="mt-2 text-xs">{t("errorBoundary.errorId", { digest: error.digest })}</p>
          )}
        </>
      }
      action={
        <Button onClick={reset} variant="default">
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("errorBoundary.retry")}
        </Button>
      }
    />
  );
}
