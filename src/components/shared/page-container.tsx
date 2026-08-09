/**
 * PageContainer 标准页面容器
 * ======================
 *
 * 为所有页面提供统一的布局结构：面包屑 + 标题区 + 内容区。
 * 减少重复的布局代码，保持页面间视觉一致性。
 *
 * 使用方式：
 *   <PageContainer
 *     title="团队管理"
 *     description="管理你的团队成员和权限"
 *     breadcrumbs={[
 *       { label: "仪表盘", href: "/dashboard" },
 *       { label: "团队" },
 *     ]}
 *     actions={<Button>邀请成员</Button>}
 *   >
 *     <div>页面内容...</div>
 *   </PageContainer>
 */

import type { BreadcrumbSegment } from "./breadcrumbs";
import { Breadcrumbs } from "./breadcrumbs";
import { cn } from "@/lib/utils";

interface PageContainerProps {
  /** 页面标题 */
  title: string;
  /** 页面描述 */
  description?: string;
  /** 面包屑导航 */
  breadcrumbs?: BreadcrumbSegment[];
  /** 右上角操作区 */
  actions?: React.ReactNode;
  /** 页面子内容 */
  children: React.ReactNode;
  /** 额外的 CSS 类名 */
  className?: string;
}

export function PageContainer({
  title,
  description,
  breadcrumbs,
  actions,
  children,
  className,
}: PageContainerProps) {
  return (
    <div className={cn("space-y-8", className)}>
      {/* 面包屑导航 */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumbs segments={breadcrumbs} />
      )}

      {/* 标题区 */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          {description && (
            <p className="text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2 mt-2 sm:mt-0">{actions}</div>}
      </div>

      {/* 页面内容 */}
      <div>{children}</div>
    </div>
  );
}
