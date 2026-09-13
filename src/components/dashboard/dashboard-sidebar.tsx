"use client";

/**
 * 仪表盘侧边栏导航组件
 * 包含菜单项：仪表盘总览、分析、项目、API 密钥、团队、通知、设置等
 * 管理员角色额外显示管理后台入口
 * 响应式设计：桌面显示完整文字 + 图标，折叠时仅显示图标
 * 使用 useTranslations 实现国际化
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/lib/constants";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { LayoutDashboard, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ADMIN_NAV_LINK,
  buildDashboardNavLinks,
  isNotificationsLink,
} from "./dashboard-nav-links";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useUnreadNotificationCount } from "@/hooks/use-unread-notifications";

export function DashboardSidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const t = useTranslations("common");
  const isAdmin = useIsAdmin();
  const unreadCount = useUnreadNotificationCount();
  const sidebarLinks = buildDashboardNavLinks(t);

  return (
    <aside
      className={cn(
        "relative hidden border-r bg-background transition-all duration-200 md:block",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div className="flex h-full flex-col gap-2 p-3">
        <div className="flex items-center justify-between py-2">
          {!collapsed && (
            <Link href={ROUTES.dashboard} className="flex items-center gap-2 font-semibold">
              <LayoutDashboard className="h-5 w-5" />
              <span>{t("dashboard")}</span>
            </Link>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-8 w-8", collapsed && "mx-auto")}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>

        <nav className="flex flex-col gap-1">
          {sidebarLinks.map((link) => {
            const Icon = link.icon;
            const isActive = pathname === link.href;

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
                  collapsed && "justify-center px-2",
                )}
                title={collapsed ? link.label : undefined}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span>{link.label}</span>}
                {isNotificationsLink(link.href) && unreadCount > 0 && !collapsed && (
                  <span
                    className={cn(
                      "ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold",
                      isActive ? "bg-primary-foreground text-primary" : "bg-primary text-primary-foreground",
                    )}
                  >
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
                {isNotificationsLink(link.href) && unreadCount > 0 && collapsed && (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                )}
              </Link>
            );
          })}

          {/* 管理员专属入口 */}
          {isAdmin && !collapsed && (
            <>
              <div className="my-2 border-t" />
              <Link
                href={ADMIN_NAV_LINK.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  pathname.startsWith("/dashboard/admin")
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <ADMIN_NAV_LINK.icon className="h-4 w-4 shrink-0" />
                <span>{t("admin")}</span>
              </Link>
            </>
          )}
          {isAdmin && collapsed && (
            <Link
              href={ADMIN_NAV_LINK.href}
              className={cn(
                "flex items-center justify-center rounded-lg px-2 py-2 text-sm font-medium transition-colors",
                pathname.startsWith("/dashboard/admin")
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
              title={t("admin")}
            >
              <ADMIN_NAV_LINK.icon className="h-4 w-4 shrink-0" />
            </Link>
          )}
        </nav>
      </div>
    </aside>
  );
}
