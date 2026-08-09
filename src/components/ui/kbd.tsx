/**
 * Kbd — 键盘快捷键指示器组件
 * 用于显示键盘快捷键组合，如 ⌘K、Ctrl+S、⌘⇧P 等
 *
 * @example
 * <Kbd>⌘K</Kbd>
 * <Kbd variant="outline">Ctrl+S</Kbd>
 * <Kbd size="sm">Esc</Kbd>
 */

import { cn } from "@/lib/utils"

type KbdVariant = "default" | "outline" | "ghost"
type KbdSize = "sm" | "default" | "lg"

interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  variant?: KbdVariant
  size?: KbdSize
}

const variantStyles: Record<KbdVariant, string> = {
  default:
    "bg-muted text-muted-foreground border shadow-sm",
  outline:
    "bg-background text-foreground border-2",
  ghost:
    "bg-transparent text-muted-foreground",
}

const sizeStyles: Record<KbdSize, string> = {
  sm: "h-5 min-w-5 px-1 text-[10px]",
  default: "h-6 min-w-6 px-1.5 text-xs",
  lg: "h-8 min-w-8 px-2 text-sm",
}

export function Kbd({
  className,
  variant = "default",
  size = "default",
  children,
  ...props
}: KbdProps) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center justify-center rounded font-mono font-medium",
        "leading-none select-none",
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      {...props}
    >
      {children}
    </kbd>
  )
}
