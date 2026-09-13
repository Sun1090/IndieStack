/**
 * 错误状态占位组件（G04）
 * =====================
 *
 * 统一「图片/图标 + 标题 + 说明 + 操作」的错误展示：应用级/仪表盘级错误边界、
 * 查询失败重试卡片、失效链接提示都复用它，避免每个错误态各写一套 markup
 * （既有实现里 `role="alert"`、图标尺寸、间距、文案层级各不一致）。
 *
 * 无状态展示组件不声明客户端边界：服务端错误页可以传入 Lucide 图标函数，
 * 需要交互的调用方（如 `QueryErrorState`）自行做成客户端组件并把按钮作为 `action` 传入。
 */

import { AlertTriangle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ErrorStateProps {
  /** 大号状态码（404/500），可选；渲染为页面唯一的 h1。 */
  code?: string;
  /** 图标，默认 AlertTriangle。 */
  icon?: LucideIcon;
  /** 标题（已翻译）。 */
  title?: string;
  /** 说明文本（已翻译），可以是多段节点。 */
  description?: React.ReactNode;
  /** 操作区，例如重试按钮或返回链接。 */
  action?: React.ReactNode;
  /** `inline`（卡片内，默认）/ `page`（整页兜底）。 */
  size?: "inline" | "page";
  /** ARIA 角色：默认 `alert`；只读的提示类错误可传 `status`。 */
  role?: "alert" | "status";
  className?: string;
}

export function ErrorState({
  code,
  icon: Icon = AlertTriangle,
  title,
  description,
  action,
  size = "inline",
  role = "alert",
  className,
}: ErrorStateProps) {
  return (
    <div
      role={role}
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-center",
        size === "page" ? "min-h-[50vh] p-6" : "py-10",
        className,
      )}
    >
      {code && <h1 className="text-6xl font-bold">{code}</h1>}
      <div className="bg-destructive/10 flex h-12 w-12 items-center justify-center rounded-full">
        <Icon className="text-destructive h-6 w-6" aria-hidden="true" />
      </div>
      {title && <p className="font-medium">{title}</p>}
      {description && <div className="text-muted-foreground text-sm">{description}</div>}
      {action}
    </div>
  );
}
