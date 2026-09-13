/**
 * 主题单一事实来源（G05）
 *
 * localStorage 键名、解析规则与首屏阻塞脚本集中在此：
 * 根布局（服务端）、ThemeProvider、ThemeToggle 与 E2E 测试共用同一份定义。
 * 背景：Provider 曾写 "ui-theme"、其它地方读 "theme"，键名不一致导致
 * 已保存主题无法恢复，切换后刷新即回到浅色。
 */

/** 主题持久化键（唯一来源，禁止在别处硬编码） */
export const THEME_STORAGE_KEY = "ui-theme";

/** 用户可选主题：system 表示跟随操作系统 */
export type Theme = "dark" | "light" | "system";

/** 解析后的实际主题，system 已折叠为具体值 */
export type ResolvedTheme = "dark" | "light";

/**
 * 把持久化值 + 系统偏好解析为实际生效的主题。
 * 缺失或非法值按 system 处理（跟随 prefers-color-scheme）。
 */
export function resolveTheme(
  stored: string | null | undefined,
  prefersDark: boolean,
): ResolvedTheme {
  if (stored === "dark" || stored === "light") {
    return stored;
  }
  return prefersDark ? "dark" : "light";
}

/**
 * 首屏阻塞脚本源码。
 *
 * 内联在 <head> 中、CSS 解析前同步执行，让深色用户不再看到浅色首帧。
 * localStorage 与 matchMedia 各自独立兜底：Safari 隐私模式、禁用存储或
 * 空 <head> 环境抛错时退化为系统偏好，而不是整段脚本中断。
 */
export function buildThemeScript(storageKey: string = THEME_STORAGE_KEY): string {
  return `(function () {
  var prefersDark = false;
  try {
    prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch (error) {
    prefersDark = false;
  }
  var stored = null;
  try {
    stored = window.localStorage.getItem(${JSON.stringify(storageKey)});
  } catch (error) {
    stored = null;
  }
  var dark = stored === "dark" || (stored !== "light" && prefersDark);
  var root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(dark ? "dark" : "light");
  root.style.colorScheme = dark ? "dark" : "light";
})();`;
}
