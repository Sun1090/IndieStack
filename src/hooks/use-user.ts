/**
 * 用户认证状态 Hook
 * 封装 Supabase Auth 客户端，提供当前用户信息和加载状态
 */

"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

/**
 * Hook to get the current user in client components.
 * Also refreshes the session on mount.
 */
export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    /**
     * 两路写入同一个 state：快照是**发起那一刻**的会话，推送是当时的真相。
     * 推送先来（登出、换会话）之后，迟到的快照不许再回头把人盖上去。
     */
    let sawEvent = false;

    const getUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (sawEvent) return;
      setUser(user);
      setLoading(false);
    };

    getUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      sawEvent = true;
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  return { user, loading };
}
