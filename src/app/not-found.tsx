/**
 * 404 页面组件（多语言）
 * 当用户访问不存在的页面时显示
 * 从 Cookie 获取用户语言偏好，显示对应语言的错误信息
 * 展示层走共享 ErrorState（G04）
 */

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/shared/error-state";
import { ROUTES } from "@/lib/constants";

export default async function NotFound() {
  const t = await getTranslations("errors");

  return (
    <ErrorState
      code="404"
      size="page"
      role="status"
      className="min-h-screen"
      title={t("notFound.title")}
      description={<p>{t("notFound.desc")}</p>}
      action={
        <div className="flex gap-4">
          <Button asChild>
            <Link href={ROUTES.home}>{t("notFound.backHome")}</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={ROUTES.contact}>{t("notFound.contactSupport")}</Link>
          </Button>
        </div>
      }
    />
  );
}
