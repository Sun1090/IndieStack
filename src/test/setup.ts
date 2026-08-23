/**
 * 组件测试全局 setup（仅 jsdom 项目加载）
 * - 接入 jest-dom 断言
 * - 每个 用例 后自动卸载组件，防止用例间 DOM 泄漏
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// Radix UI 组件依赖 ResizeObserver
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
