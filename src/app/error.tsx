/**
 * 全局错误边界组件（多语言）
 * 当页面渲染发生未捕获错误时显示
 * 提供重试按钮，展示层走共享 ErrorState（G04）
 */

"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/shared/error-state";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      code="500"
      size="page"
      className="min-h-screen"
      title={t("errorBoundary.title")}
      description={
        <>
          <p>{t("errorBoundary.desc")}</p>
          {error.digest && (
            <p className="mt-2 text-xs">{t("errorBoundary.errorId", { digest: error.digest })}</p>
          )}
        </>
      }
      action={<Button onClick={reset}>{t("errorBoundary.retry")}</Button>}
    />
  );
}
