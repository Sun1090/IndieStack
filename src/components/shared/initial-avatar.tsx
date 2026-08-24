"use client";

/**
 * 首字母头像
 * 无 OSS 依赖的本地头像方案：取姓名/邮箱首字符，按哈希分配背景色
 */

import { cn } from "@/lib/utils";

const PALETTE = [
  "bg-red-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-sky-500",
  "bg-indigo-500",
  "bg-purple-500",
];

function pickColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function initialOf(nameOrEmail: string): string {
  const value = nameOrEmail.trim();
  if (!value) return "?";
  // 中文取姓氏；英文/邮箱取首字符大写
  const char = value.codePointAt(0) ?? 63;
  if (char > 0x2e7f) return String.fromCodePoint(char);
  const letter = value.includes("@") ? value[0] : (value.split(/\s+/)[0]?.[0] ?? value[0]);
  return letter.toUpperCase();
}

interface InitialAvatarProps {
  name: string;
  className?: string;
}

export function InitialAvatar({ name, className }: InitialAvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white select-none",
        pickColor(name),
        className,
      )}
    >
      {initialOf(name)}
    </span>
  );
}
