"use client";

/**
 * 当前用户是否为管理员（admin / super_admin）。
 * 侧边栏与移动端抽屉共用，避免各自维护一份角色查询。
 *
 * 结果与 userId 绑定存储：用户切换或登出时无需在 effect 里同步清空状态，
 * 直接由返回值判定（避免 effect 内 setState 造成级联渲染）。
 */
import { useEffect, useState } from "react";
import { useUser } from "@/hooks/use-user";
import { createClient } from "@/lib/supabase/client";

type AdminState = { userId: string; isAdmin: boolean };

export function useIsAdmin(): boolean {
  const { user } = useUser();
  const [state, setState] = useState<AdminState | null>(null);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    createClient()
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()
      .then(({ data }: { data: { role?: string } | null }) => {
        if (cancelled) return;
        const role = data?.role;
        setState({ userId: user.id, isAdmin: role === "admin" || role === "super_admin" });
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) return false;
  return state?.userId === user.id ? state.isAdmin : false;
}
