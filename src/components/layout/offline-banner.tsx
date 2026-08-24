"use client";

/**
 * 离线检测横幅
 * navigator.onLine 变为离线时在页面顶部显示提示条，恢复在线自动消失
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { WifiOff } from "lucide-react";

export function OfflineBanner() {
  const t = useTranslations("common");
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-[200] flex items-center justify-center gap-2 bg-amber-500 px-4 py-1.5 text-sm font-medium text-white"
    >
      <WifiOff className="h-4 w-4" />
      {t("offline")}
    </div>
  );
}
