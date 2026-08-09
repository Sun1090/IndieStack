/**
 * useMediaQuery — 响应式媒体查询 Hook
 * 监听 CSS 媒体查询状态变化，常用于响应式组件逻辑
 *
 * @example
 * const isMobile = useMediaQuery("(max-width: 768px)")
 * const isDark = useMediaQuery("(prefers-color-scheme: dark)")
 */
"use client";

export { useMediaQuery } from "usehooks-ts";