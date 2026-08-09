/**
 * Breadcrumbs 面包屑导航组件
 * ======================
 *
 * 自动生成当前路径的面包屑导航，支持自定义链接和图标。
 *
 * 使用方式：
 *   <Breadcrumbs segments={[
 *     { label: "仪表盘", href: "/dashboard" },
 *     { label: "项目", href: "/dashboard/projects" },
 *     { label: "当前页面" },
 *   ]} />
 */

import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";

export interface BreadcrumbSegment {
  /** 显示文本 */
  label: string;
  /** 链接地址（无 href 则为当前页，不渲染链接） */
  href?: string;
}

interface BreadcrumbsProps {
  /** 面包屑路径片段 */
  segments: BreadcrumbSegment[];
  /** 是否显示首页图标（默认 true） */
  showHomeIcon?: boolean;
  /** 分隔符图标（默认 ChevronRight） */
  separator?: React.ReactNode;
  /** 自定义首页段 */
  homeSegment?: BreadcrumbSegment;
}

export function Breadcrumbs({
  segments,
  showHomeIcon = true,
  separator = <ChevronRight className="h-4 w-4" />,
  homeSegment = { label: "首页", href: "/" },
}: BreadcrumbsProps) {
  const allSegments = showHomeIcon ? [homeSegment, ...segments] : segments;

  return (
    <nav aria-label="面包屑导航" className="mb-4">
      <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {allSegments.map((segment, index) => {
          const isLast = index === allSegments.length - 1;

          return (
            <li key={`${segment.label}-${index}`} className="flex items-center gap-1.5">
              {index > 0 && separator}
              {segment.href && !isLast ? (
                <Link
                  href={segment.href}
                  className="transition-colors hover:text-foreground"
                >
                  {index === 0 && showHomeIcon ? (
                    <Home className="h-4 w-4" />
                  ) : (
                    segment.label
                  )}
                </Link>
              ) : (
                <span className={isLast ? "text-foreground font-medium" : ""}>
                  {index === 0 && showHomeIcon ? (
                    <Home className="h-4 w-4" />
                  ) : (
                    segment.label
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
