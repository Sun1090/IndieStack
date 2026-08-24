"use client";

/**
 * 路由切换顶部进度条
 * 监听 pathname 变化，显示 300ms 顶栏动画（轻量 NProgress 替代，零依赖）
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export function NavigationProgress() {
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // pathname 变化：微任务延迟置位避免同步 setState 级联
    const show = setTimeout(() => setLoading(true), 0);
    const hide = setTimeout(() => setLoading(false), 300);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [pathname]);

  if (!loading) return null;

  return (
    <div
      role="progressbar"
      aria-label="navigation"
      className="fixed inset-x-0 top-0 z-[300] h-0.5 overflow-hidden bg-transparent"
    >
      <div className="h-full w-1/3 animate-[navprogress_0.8s_ease-in-out_infinite] bg-primary" />
    </div>
  );
}
