"use client";

/**
 * 移动端仪表盘导航抽屉（G06）
 *
 * 背景：侧边栏此前是 `hidden md:block`，手机上整个导航直接消失，
 * 用户只能改地址栏才能到达分析/团队/设置等页面。
 * 现在复用 ui/sheet（Radix Dialog）在 <768px 提供可达的导航入口，
 * 链接定义与桌面侧边栏共用 dashboard-nav-links，保证两侧不漂移。
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { ADMIN_NAV_LINK, buildDashboardNavLinks, isNotificationsLink } from "./dashboard-nav-links";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useUnreadNotificationCount } from "@/hooks/use-unread-notifications";

export function MobileDashboardNav() {
  const pathname = usePathname();
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const isAdmin = useIsAdmin();
  const unreadCount = useUnreadNotificationCount();
  const links = buildDashboardNavLinks(t);

  // 路由变化后自动关闭抽屉，避免跳转后遮住新页面。
  // 用 render 期间同步 state 的官方模式（而非 effect + setState），避免级联渲染。
  const [lastPathname, setLastPathname] = useState(pathname);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    setOpen(false);
  }

  return (
    <div className="flex items-center border-b px-4 py-2 md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            aria-label={t("dashboardMenu")}
          >
            <Menu className="h-4 w-4" />
            {t("menu")}
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 overflow-y-auto" aria-describedby={undefined}>
          <SheetHeader className="text-start">
            <SheetTitle>{t("dashboard")}</SheetTitle>
          </SheetHeader>
          <nav aria-label={t("dashboard")} className="flex flex-col gap-1">
            {links.map((link) => {
              const isActive = pathname === link.href;
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{link.label}</span>
                  {isNotificationsLink(link.href) && unreadCount > 0 && (
                    <span
                      className={cn(
                        "ms-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold",
                        isActive
                          ? "bg-primary-foreground text-primary"
                          : "bg-primary text-primary-foreground",
                      )}
                    >
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </Link>
              );
            })}

            {isAdmin && (
              <>
                <div className="my-2 border-t" />
                <Link
                  href={ADMIN_NAV_LINK.href}
                  aria-current={pathname.startsWith(ADMIN_NAV_LINK.href) ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    pathname.startsWith(ADMIN_NAV_LINK.href)
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <ADMIN_NAV_LINK.icon className="h-4 w-4 shrink-0" />
                  <span>{t("admin")}</span>
                </Link>
              </>
            )}
          </nav>
        </SheetContent>
      </Sheet>
    </div>
  );
}
