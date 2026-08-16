/** * Supabase 客户端 Provider 组件 * 在 React 上下文中提供 Supabase 浏览器客户端实例 * 用于 Client Components 中的认证操作和数据库查询 */

"use client";

import { createContext, useContext, useState, useMemo } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

type SupabaseContext = {
  supabase: SupabaseClient | null;
  isReady: boolean;
};

const Context = createContext<SupabaseContext>({ supabase: null, isReady: false });

export function SupabaseProvider({ children }: { children: React.ReactNode }) {
  const configured = useMemo(() => isSupabaseConfigured(), []);
  const [supabase] = useState<SupabaseClient | null>(() => {
    if (!configured) return null;
    try {
      return createClient() as unknown as SupabaseClient;
    } catch {
      return null;
    }
  });

  return (
    <Context.Provider value={{ supabase, isReady: configured && supabase !== null }}>
      {children}
    </Context.Provider>
  );
}

export function useSupabase() {
  const context = useContext(Context);
  if (context === undefined) {
    throw new Error("useSupabase must be used inside SupabaseProvider");
  }
  return context;
}
