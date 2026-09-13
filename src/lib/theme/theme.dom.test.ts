/**
 * 首屏主题脚本的真实 DOM 行为测试（G05）
 * 在 jsdom 中同步执行与 <head> 内联脚本相同的源码，
 * 证明 hydration 之前 html class 就已经正确（否则深色用户会看到浅色首帧）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildThemeScript, THEME_STORAGE_KEY } from "./theme";

type MatchMediaLike = {
  matches: boolean;
  media: string;
  onchange: null;
  addEventListener: () => void;
  removeEventListener: () => void;
  addListener: () => void;
  removeListener: () => void;
  dispatchEvent: () => boolean;
};

function stubMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation(
    (query: string): MatchMediaLike => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  ) as unknown as typeof window.matchMedia;
}

/** 与浏览器执行内联 <script> 等价：同一份源码、同一时机（同步） */
function runThemeScript() {
  new Function(buildThemeScript())();
}

function htmlThemeClass() {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

beforeEach(() => {
  document.documentElement.className = "";
  document.documentElement.removeAttribute("style");
  window.localStorage.clear();
  stubMatchMedia(false);
});

describe("首屏主题脚本", () => {
  it("已保存 dark：立即标记 dark 并同步 color-scheme", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

    runThemeScript();

    expect(htmlThemeClass()).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("已保存 light：即使系统偏好深色也保持浅色", () => {
    stubMatchMedia(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");

    runThemeScript();

    expect(htmlThemeClass()).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("未保存主题：跟随系统偏好", () => {
    stubMatchMedia(true);

    runThemeScript();

    expect(htmlThemeClass()).toBe("dark");
  });

  it("隐藏旧 class 时不残留 light/dark 两个标记", () => {
    document.documentElement.classList.add("light", "dark");
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

    runThemeScript();

    expect(document.documentElement.className.split(/\s+/).filter(Boolean)).toEqual(["dark"]);
  });

  it("localStorage 抛错（隐私模式）时退化为系统偏好而不是中断", () => {
    stubMatchMedia(true);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    expect(() => runThemeScript()).not.toThrow();
    expect(htmlThemeClass()).toBe("dark");
  });

  it("matchMedia 不可用时退化为浅色且不抛错", () => {
    // @ts-expect-error 模拟老浏览器/受限环境缺少 matchMedia
    window.matchMedia = undefined;

    expect(() => runThemeScript()).not.toThrow();
    expect(htmlThemeClass()).toBe("light");
  });
});
