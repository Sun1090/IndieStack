/**
 * 营销页面布局组件
 * 为所有营销页面（功能、定价、关于、博客等）提供一致的 SiteHeader 和 SiteFooter
 */

import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
