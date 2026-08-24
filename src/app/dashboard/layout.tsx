/**
 * 仪表盘布局组件
 * 为所有仪表盘页面提供侧边栏导航和顶部操作栏
 * 需要身份认证，未登录用户将被重定向到登录页
 */

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ROUTES } from "@/lib/constants";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
import { CommandPalette } from "@/components/layout/command-palette";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(ROUTES.login);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="flex flex-1">
        <DashboardSidebar />
        <CommandPalette />
        <main id="main-content" className="flex-1 overflow-auto p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
