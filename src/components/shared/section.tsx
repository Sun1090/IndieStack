/** * 通用区块容器组件 * 提供一致的区块布局：标题、描述、分隔线和内容区域 * 用于营销页面中各功能模块的布局 */

import { cn } from "@/lib/utils";

interface SectionProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function Section({ title, description, children, className }: SectionProps) {
  return (
    <div className={cn("space-y-4", className)}>
      {title && (
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      )}
      {children}
    </div>
  );
}
