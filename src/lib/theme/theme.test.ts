/**
 * 主题解析与首屏脚本源码测试（G05）
 * 键名/解析规则一旦漂移，深色首帧与持久化就会回归，故在此锁定契约。
 */
import { describe, expect, it } from "vitest";
import { buildThemeScript, resolveTheme, THEME_STORAGE_KEY } from "./theme";

describe("resolveTheme", () => {
  it("保存 dark 时忽略系统偏好", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("保存 light 时忽略系统偏好", () => {
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("未保存主题时跟随系统偏好", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
  });

  it("保存 system 或非法值时跟随系统偏好", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("solarized", true)).toBe("dark");
  });
});

describe("buildThemeScript", () => {
  it("内联默认存储键，保证脚本与 Provider 读写同一位置", () => {
    expect(THEME_STORAGE_KEY).toBe("ui-theme");
    expect(buildThemeScript()).toContain(`"${THEME_STORAGE_KEY}"`);
  });

  it("同时维护 dark class 与 color-scheme", () => {
    const script = buildThemeScript();

    expect(script).toContain('classList.add(dark ? "dark" : "light")');
    expect(script).toContain("root.style.colorScheme");
  });

  it("localStorage 与 matchMedia 都单独兜底", () => {
    const script = buildThemeScript();

    expect(script).toContain("window.localStorage.getItem");
    expect(script.match(/try \{/g)).toHaveLength(2);
  });
});
