/**
 * 页面底部组件
 * 包含品牌信息、导航链接分组和版权声明
 * 使用 i18n 消息系统实现多语言支持
 */
import { SITE_CONFIG, ROUTES } from "@/lib/constants";
import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="container py-12">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {/* 品牌信息区 */}
          <div className="space-y-4">
            <Link href={ROUTES.home} className="text-lg font-bold">
              {SITE_CONFIG.name}
            </Link>
            <p className="max-w-xs text-sm text-muted-foreground">
              A production-ready IndieStack for indie developers. Modern stack, minimal setup.
            </p>
          </div>

          {/* 导航链接分组 */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Product</h4>
            <ul className="space-y-2">
              <li><Link href={ROUTES.features} className="text-sm text-muted-foreground transition-colors hover:text-foreground">Features</Link></li>
              <li><Link href={ROUTES.pricing} className="text-sm text-muted-foreground transition-colors hover:text-foreground">Pricing</Link></li>
              <li><Link href={ROUTES.contact} className="text-sm text-muted-foreground transition-colors hover:text-foreground">Contact</Link></li>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Resources</h4>
            <ul className="space-y-2">
              <li><a href={ROUTES.docs} className="text-sm text-muted-foreground transition-colors hover:text-foreground" target="_blank" rel="noopener noreferrer">Documentation</a></li>
              <li><Link href="#" className="text-sm text-muted-foreground transition-colors hover:text-foreground">API Reference</Link></li>
              <li><Link href="#" className="text-sm text-muted-foreground transition-colors hover:text-foreground">Status</Link></li>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Company</h4>
            <ul className="space-y-2">
              <li><Link href={ROUTES.about} className="text-sm text-muted-foreground transition-colors hover:text-foreground">About</Link></li>
              <li><Link href={ROUTES.blog} className="text-sm text-muted-foreground transition-colors hover:text-foreground">Blog</Link></li>
              <li><Link href={ROUTES.privacy} className="text-sm text-muted-foreground transition-colors hover:text-foreground">Privacy</Link></li>
              <li><Link href={ROUTES.terms} className="text-sm text-muted-foreground transition-colors hover:text-foreground">Terms</Link></li>
              <li><Link href={SITE_CONFIG.links.github} className="text-sm text-muted-foreground transition-colors hover:text-foreground">GitHub</Link></li>
            </ul>
          </div>
        </div>

        {/* 版权声明和法律信息 */}
        <div className="mt-8 border-t pt-8">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <p className="text-center text-sm text-muted-foreground">
              Built with{" "}
              <Link href="https://nextjs.org" target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">Next.js</Link>
              ,{" "}
              <Link href="https://tailwindcss.com" target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">Tailwind CSS</Link>
              ,{" "}
              <Link href="https://ui.shadcn.com" target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">shadcn/ui</Link>
              , and{" "}
              <Link href="https://supabase.com" target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">Supabase</Link>.
            </p>
            <p className="text-center text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} {SITE_CONFIG.name}. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
