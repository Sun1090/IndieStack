/**
 * 通用工具函数
 * 提供 cn() 类名合并函数等通用工具
 */
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind CSS classes with conflict resolution.
 * Uses clsx for conditional classes and tailwind-merge for deduplication.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a number with commas.
 */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat("zh-CN").format(n);
}

/**
 * Generate a random ID using crypto.randomUUID (Web Crypto API).
 * Falls back to a timestamp-based ID if crypto is unavailable.
 */
export function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // fallback for older environments
  return `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Absolute URL helper for emails and canonical URLs.
 */
export function absoluteUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}