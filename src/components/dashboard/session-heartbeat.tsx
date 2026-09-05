"use client";
/**
 * 会话心跳（v0.5.0 D02）
 * 挂载在 dashboard 布局：每次进入仪表盘时登记/刷新当前设备会话（last_seen_at）。
 * 纯旁路：失败静默，不影响任何主流程。
 */

import { useEffect } from "react";
import { recordCurrentSession } from "@/lib/actions/sessions";

export function SessionHeartbeat() {
  useEffect(() => {
    void recordCurrentSession();
  }, []);
  return null;
}
