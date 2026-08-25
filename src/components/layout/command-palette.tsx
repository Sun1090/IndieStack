"use client";

/**
 * 全局命令面板（⌘K / Ctrl+K）
 * 快速导航到 dashboard 各页面；Esc 关闭，选中后路由跳转
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/components/providers/theme-provider";
import { useTranslations } from "next-intl";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  FolderKanban,
  KeyRound,
  Users,
  ScrollText,
  BarChart3,
  Settings,
  UserCircle,
  Bell,
  CreditCard,
  Webhook,
} from "lucide-react";

const items = [
  { group: "dashboard", labelKey: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { group: "dashboard", labelKey: "projects", href: "/dashboard/projects", icon: FolderKanban },
  { group: "dashboard", labelKey: "analytics", href: "/dashboard/analytics", icon: BarChart3 },
  { group: "dashboard", labelKey: "apiKeys", href: "/dashboard/api-keys", icon: KeyRound },
  { group: "dashboard", labelKey: "team", href: "/dashboard/team", icon: Users },
  { group: "dashboard", labelKey: "notifications", href: "/dashboard/notifications", icon: Bell },
  { group: "dashboard", labelKey: "billing", href: "/dashboard/billing", icon: CreditCard },
  { separator: true },
  { group: "account", labelKey: "profile", href: "/dashboard/profile", icon: UserCircle },
  { group: "account", labelKey: "settings", href: "/dashboard/settings", icon: Settings },
] as const;

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { setTheme } = useTheme();
  const t = useTranslations("common");

  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        // 打开前同步读取最近路由（避免 effect 内 setState）
        try {
          const raw = localStorage.getItem("recent-dashboard-routes");
          setRecent(raw ? (JSON.parse(raw) as string[]).slice(0, 3) : []);
        } catch {
          setRecent([]);
        }
        setOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function run(href: string) {
    setOpen(false);
    // 记录最近访问（去重、最新在前）
    try {
      const prev = JSON.parse(localStorage.getItem("recent-dashboard-routes") ?? "[]") as string[];
      const next = [href, ...prev.filter((h) => h !== href)].slice(0, 5);
      localStorage.setItem("recent-dashboard-routes", JSON.stringify(next));
    } catch {
      // localStorage 不可用时静默跳过
    }
    router.push(href);
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder={t("commandPalette.placeholder")} />
      <CommandList>
        <CommandEmpty>{t("commandPalette.empty")}</CommandEmpty>
        <CommandGroup heading={t("commandPalette.theme")}>
          <CommandItem value="theme-light" onSelect={() => { setTheme("light"); setOpen(false); }}>
            ☀️ {t("theme.light")}
          </CommandItem>
          <CommandItem value="theme-dark" onSelect={() => { setTheme("dark"); setOpen(false); }}>
            🌙 {t("theme.dark")}
          </CommandItem>
          <CommandItem value="theme-system" onSelect={() => { setTheme("system"); setOpen(false); }}>
            💻 {t("theme.system")}
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        {recent.length > 0 && (
          <>
            <CommandGroup heading={t("commandPalette.recent")}>
              {recent.map((href) => {
                const item = items.find((i) => !("separator" in i) && i.href === href);
                if (!item) return null;
                const Icon = ("icon" in item ? item.icon : null) as React.ComponentType<{ className?: string }>;
                return (
                  <CommandItem key={`recent-${href}`} value={`recent-${href}`} onSelect={() => run(href)}>
                    {Icon && <Icon className="mr-2 h-4 w-4" />}
                    {t(("labelKey" in item ? item.labelKey : "") as never)}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}
        <CommandGroup heading={t("commandPalette.navigateTo")}>
          {items.map((item) =>
            "separator" in item ? (
              <CommandSeparator key="sep" />
            ) : (
              <CommandItem
                key={item.href}
                value={`${item.labelKey} ${item.href}`}
                onSelect={() => run(item.href)}
              >
                <item.icon className="mr-2 h-4 w-4" />
                {t(item.labelKey)}
              </CommandItem>
            ),
          )}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
