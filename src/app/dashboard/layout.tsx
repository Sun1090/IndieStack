/**
 * 仪表盘布局组件
 * 为所有仪表盘页面提供侧边栏导航和顶部操作栏
 * 需要身份认证，未登录用户将被重定向到登录页
 */

export const dynamic = "force-dynamic";

import { requireSessionUser } from "@/lib/auth/session-user";
import { requireMfaAssurance } from "@/lib/auth/mfa-assurance";
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
  // 第二步验证（2FA）是**服务端**闸门，不是登录表单的一次跳转：
  // 开了 2FA 的账号在 aal1 会话下读 dashboard 的任何一页都会被送回挑战页。
  // 放在 layout 而不是逐页调用——漏一页就等于漏一个入口。
  await requireMfaAssurance(supabase);

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
