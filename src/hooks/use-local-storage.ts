/**
 * useLocalStorage — localStorage 持久化 Hook
 * 在 localStorage 中读写状态，支持 JSON 序列化和 SSR 安全
 *
 * @example
 * const [theme, setTheme] = useLocalStorage("theme", "light")
 * setTheme("dark") // 持久化到 localStorage
 */
"use client";

export { useLocalStorage } from "usehooks-ts";