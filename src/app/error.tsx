/**
 * 全局错误边界组件（多语言）
 * 当页面渲染发生未捕获错误时显示
 * 提供重试按钮和返回首页链接
 * 通过客户端 useTranslations Hook 读取 next-intl 中的语言消息
 */

"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";

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
    <div className="flex min-h-screen flex-col items-center justify-center">
      <div className="container flex max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-6xl font-bold">500</h1>
        <h2 className="text-2xl font-semibold">{t("errorBoundary.title")}</h2>
        <p className="text-muted-foreground">{t("errorBoundary.desc")}</p>
        <Button onClick={reset}>{t("errorBoundary.retry")}</Button>
      </div>
    </div>
  );
}
