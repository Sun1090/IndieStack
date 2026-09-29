/**
 * 仪表盘布局组件
 * 为所有仪表盘页面提供侧边栏导航和顶部操作栏
 * 需要身份认证，未登录用户将被重定向到登录页
 */

export const dynamic = "force-dynamic";

import { requireSessionUser } from "@/lib/auth/session-user";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
import { MobileDashboardNav } from "@/components/dashboard/mobile-dashboard-nav";
import { CommandPalette } from "@/components/layout/command-palette";
import { SessionHeartbeat } from "@/components/dashboard/session-heartbeat";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  await requireSessionUser(supabase);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <SessionHeartbeat />
      <div className="flex flex-1">
        <DashboardSidebar />
        <CommandPalette />
        {/* G06：<768px 侧边栏整体隐藏，移动端抽屉保证导航可达 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileDashboardNav />
          <main id="main-content" tabIndex={-1} className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
