"use client";

/**
 * 顶部导航栏组件
 * - 响应式设计：桌面端显示完整导航链接，移动端显示汉堡菜单
 * - 根据用户登录状态显示登录/注册按钮或用户下拉菜单
 * - 集成了主题切换和语言切换功能
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useUser } from "@/hooks/use-user";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { ROUTES, SITE_CONFIG } from "@/lib/constants";
import { useTranslations } from "next-intl";
import { User, Settings, LogOut, LayoutDashboard, Menu, X } from "lucide-react";

/** 判断链接是否为外部 URL */
function isExternalUrl(href: string): boolean {
  return href.startsWith("http://") || href.startsWith("https://") || href.startsWith("//");
}

export function SiteHeader() {
  const router = useRouter();
  const { user, loading } = useUser();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const t = useTranslations("nav");
  const tc = useTranslations("common");

  /** 营销页面导航链接配置 */
  const marketingLinks = [
    { href: ROUTES.home, label: t("home") },
    { href: ROUTES.features, label: t("features") },
    { href: ROUTES.pricing, label: t("pricing") },
    { href: ROUTES.about, label: t("about") },
    { href: ROUTES.blog, label: t("blog") },
    { href: ROUTES.docs, label: t("documentation") },
  ];

  /** 退出登录处理 */
  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push(ROUTES.home);
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        {/* Logo + 桌面端导航 */}
        <div className="flex items-center gap-6">
          <Link href={ROUTES.home} className="flex items-center gap-2 text-xl font-bold">
            <span>{SITE_CONFIG.name}</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {marketingLinks.map((link) =>
              isExternalUrl(link.href) ? (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {link.label}
                </Link>
              ),
            )}
          </nav>
        </div>

        {/* 右侧操作区 */}
        <div className="flex items-center gap-3">
          <LocaleSwitcher />
          <ThemeToggle />

          {loading ? (
            // 加载中状态：显示骨架屏
            <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
          ) : user ? (
            <>
              {/* 已登录：显示仪表盘按钮和用户头像下拉菜单 */}
              <Button variant="ghost" size="sm" asChild className="hidden md:flex">
                <Link href={ROUTES.dashboard}>
                  <LayoutDashboard className="mr-2 h-4 w-4" /> {t("dashboard")}
                </Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback>{user.email?.charAt(0).toUpperCase() ?? "U"}</AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" forceMount>
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none">{user.email}</p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href={ROUTES.dashboard}>
                      <LayoutDashboard className="mr-2 h-4 w-4" /> {t("dashboard")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={ROUTES.dashboardProfile}>
                      <User className="mr-2 h-4 w-4" /> {tc("profile")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={ROUTES.dashboardSettings}>
                      <Settings className="mr-2 h-4 w-4" /> {tc("settings")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut}>
                    <LogOut className="mr-2 h-4 w-4" /> {tc("signOut")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            // 未登录：显示登录和注册按钮
            <div className="hidden items-center gap-2 md:flex">
              <Button variant="ghost" asChild>
                <Link href={ROUTES.login}>{t("signIn")}</Link>
              </Button>
              <Button asChild>
                <Link href={ROUTES.register}>{t("signUp")}</Link>
              </Button>
            </div>
          )}

          {/* 移动端菜单切换按钮 */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* 移动端导航菜单 */}
      {mobileMenuOpen && (
        <div className="border-t md:hidden">
          <div className="container space-y-3 py-4">
            <nav className="flex flex-col gap-1">
              {marketingLinks.map((link) =>
                isExternalUrl(link.href) ? (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md px-3 py-2 text-sm font-medium hover:bg-accent"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="rounded-md px-3 py-2 text-sm font-medium hover:bg-accent"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {link.label}
                  </Link>
                ),
              )}
            </nav>
            {!user && (
              <div className="flex flex-col gap-2 border-t pt-2">
                <Button variant="outline" asChild className="w-full">
                  <Link href={ROUTES.login} onClick={() => setMobileMenuOpen(false)}>
                    {t("signIn")}
                  </Link>
                </Button>
                <Button asChild className="w-full">
                  <Link href={ROUTES.register} onClick={() => setMobileMenuOpen(false)}>
                    {t("signUp")}
                  </Link>
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
