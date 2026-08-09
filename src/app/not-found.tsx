/**
 * 404 页面组件（多语言）
 * 当用户访问不存在的页面时显示
 * 从 Cookie 获取用户语言偏好，显示对应语言的错误信息
 */

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("errors");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <div className="container flex max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-6xl font-bold">404</h1>
        <h2 className="text-2xl font-semibold">{t("notFound.title")}</h2>
        <p className="text-muted-foreground">{t("notFound.desc")}</p>
        <div className="flex gap-4">
          <Button asChild>
            <Link href={ROUTES.home}>{t("notFound.backHome")}</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={ROUTES.dashboard}>{t("notFound.contactSupport")}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
