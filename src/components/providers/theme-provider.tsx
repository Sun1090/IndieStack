/**
 * 主题 Provider 组件
 * 提供 light/dark/system 主题切换，并让 system 模式跟随操作系统实时变化。
 * 存储键与解析规则来自 @/lib/theme/theme，与首屏内联脚本共用同一份定义（G05）。
 */

"use client";

import { createContext, useContext, useEffect, useState } from "react";
import {
  resolveTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type Theme,
} from "@/lib/theme/theme";

export type { Theme };

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
  attribute?: string;
  enableSystem?: boolean;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

/** 读取持久化主题：隐私模式下 localStorage 会抛错，此时退化为默认值 */
function readStoredTheme(storageKey: string, defaultTheme: Theme): Theme {
  if (typeof window === "undefined") return defaultTheme;
  try {
    return (window.localStorage.getItem(storageKey) as Theme) || defaultTheme;
  } catch {
    return defaultTheme;
  }
}

/** 把解析后的主题同步到 <html>：class 供 Tailwind dark: 变体，color-scheme 供原生控件 */
function applyTheme(root: HTMLElement, resolved: ResolvedTheme) {
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = THEME_STORAGE_KEY,
  attribute = "class",
  enableSystem = true,
  ...props
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() =>
    readStoredTheme(storageKey, defaultTheme),
  );

  useEffect(() => {
    const root = window.document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const followsSystem = theme === "system" && enableSystem;

    const sync = () => {
      applyTheme(root, resolveTheme(followsSystem ? null : theme, media.matches));
    };

    sync();

    // system 模式下操作系统切换主题时实时同步（首屏脚本只负责首次渲染）
    if (!followsSystem) return;
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [theme, enableSystem]);

  const value: ThemeProviderState = {
    theme,
    setTheme: (nextTheme: Theme) => {
      try {
        window.localStorage.setItem(storageKey, nextTheme);
      } catch {
        // 存储不可用（隐私模式）时仍然切换当前会话的主题
      }
      setThemeState(nextTheme);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeProviderContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
