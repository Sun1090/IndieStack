/**
 * 仪表盘导航链接单一来源（G06）
 *
 * 桌面侧边栏与移动端抽屉共用同一份定义，避免两处漂移
 * （例如新增页面只更新了侧边栏，移动端用户看不到入口）。
 */
import { ROUTES } from "@/lib/constants";
import {
  BarChart3,
  Bell,
  CreditCard,
  FolderKanban,
  Key,
  LayoutDashboard,
  Puzzle,
  Settings,
  Shield,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";

export type DashboardNavLink = {
  href: string;
  label: string;
  icon: LucideIcon;
};

/** 按当前语言构建导航链接（t 来自 useTranslations("common")） */
export function buildDashboardNavLinks(t: (key: string) => string): DashboardNavLink[] {
  return [
    { href: ROUTES.dashboard, label: t("dashboard"), icon: LayoutDashboard },
    { href: ROUTES.dashboardAnalytics, label: t("analytics"), icon: BarChart3 },
    { href: ROUTES.dashboardProjects, label: t("projects"), icon: FolderKanban },
    { href: ROUTES.dashboardProfile, label: t("profile"), icon: User },
    { href: ROUTES.dashboardTeam, label: t("team"), icon: Users },
    { href: ROUTES.dashboardBilling, label: t("billing"), icon: CreditCard },
    { href: ROUTES.apiKeys, label: t("apiKeys"), icon: Key },
    { href: ROUTES.dashboardSettings, label: t("settings"), icon: Settings },
    { href: ROUTES.dashboardNotifications, label: t("notifications"), icon: Bell },
    { href: ROUTES.dashboardIntegrations, label: t("integrations"), icon: Puzzle },
  ];
}

/** 管理员专属入口（href 固定，标签在调用处取 t("admin")） */
export const ADMIN_NAV_LINK = {
  href: ROUTES.admin,
  icon: Shield,
} as const;

/** 通知未读 badge 只在通知入口渲染 */
export function isNotificationsLink(href: string): boolean {
  return href === ROUTES.dashboardNotifications;
}
