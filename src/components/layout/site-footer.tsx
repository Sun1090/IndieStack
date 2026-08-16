/**
 * 页面底部组件
 * 包含品牌信息、导航链接分组和版权声明
 * 使用 i18n 消息系统实现多语言支持
 */
import { SITE_CONFIG, ROUTES } from "@/lib/constants";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export async function SiteFooter() {
  const t = await getTranslations("footer");
  const tc = await getTranslations("common");

  return (
    <footer className="border-t">
      <div className="container py-12">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {/* 品牌信息区 */}
          <div className="space-y-4">
            <Link href={ROUTES.home} className="text-lg font-bold">
              {SITE_CONFIG.name}
            </Link>
            <p className="max-w-xs text-sm text-muted-foreground">{t("description")}</p>
          </div>

          {/* 导航链接分组 */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">{t("product")}</h4>
            <ul className="space-y-2">
              <li>
                <Link
                  href={ROUTES.features}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {tc("features")}
                </Link>
              </li>
              <li>
                <Link
                  href={ROUTES.pricing}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {tc("pricing")}
                </Link>
              </li>
              <li>
                <Link
                  href={ROUTES.contact}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {tc("contact")}
                </Link>
              </li>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold">{t("resources")}</h4>
            <ul className="space-y-2">
              <li>
                <a
                  href={ROUTES.docs}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {tc("documentation")}
                </a>
              </li>
              {/* API / Status 尚未上线：使用纯文本占位，避免指向 # 的死链接 */}
              <li>
                <span className="text-sm text-muted-foreground">{tc("api")}</span>
              </li>
              <li>
                <span className="text-sm text-muted-foreground">{tc("status")}</span>
              </li>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold">{t("company")}</h4>
            <ul className="space-y-2">
              <li>
                <Link
                  href={ROUTES.about}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {tc("about")}
                </Link>
              </li>
              <li>
                <Link
                  href={ROUTES.blog}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {tc("blog")}
                </Link>
              </li>
              <li>
                <Link
                  href={ROUTES.privacy}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {tc("privacy")}
                </Link>
              </li>
              <li>
                <Link
                  href={ROUTES.terms}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {tc("terms")}
                </Link>
              </li>
              <li>
                <Link
                  href={SITE_CONFIG.links.github}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {tc("github")}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* 版权声明和法律信息 */}
        <div className="mt-8 border-t pt-8">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <p className="text-center text-sm text-muted-foreground">
              {t.rich("builtWith", {
                nextjs: (chunks) => (
                  <Link
                    href="https://nextjs.org"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium underline underline-offset-4"
                  >
                    {chunks}
                  </Link>
                ),
                tailwind: (chunks) => (
                  <Link
                    href="https://tailwindcss.com"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium underline underline-offset-4"
                  >
                    {chunks}
                  </Link>
                ),
                shadcn: (chunks) => (
                  <Link
                    href="https://ui.shadcn.com"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium underline underline-offset-4"
                  >
                    {chunks}
                  </Link>
                ),
                supabase: (chunks) => (
                  <Link
                    href="https://supabase.com"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium underline underline-offset-4"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </p>
            <p className="text-center text-sm text-muted-foreground">
              {t("copyright", { year: new Date().getFullYear(), name: SITE_CONFIG.name })}
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
