/**
 * 审计日志页面（仅限 super_admin）
 * 查看平台的操作审计日志，支持按操作类型、用户、时间筛选
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, RefreshCw, Filter } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { listAuditLogs, type AuditLogRecord } from "@/lib/actions/admin";

export default function AdminAuditLogsPage() {
  const t = useTranslations("admin");
  const ta = useTranslations("actions");
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");

  const loadLogs = useCallback(async () => {
    setLoading(true);
    const result = await listAuditLogs();
    if (!result.success) {
      toast({ title: t("auditLogs.noLogs"), description: ta(result.error), variant: "destructive" });
    } else {
      setLogs(result.data);
    }
    setLoading(false);
  }, [t, ta]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // 筛选后的日志
  const filteredLogs = logs.filter((log) => {
    if (actionFilter !== "all" && !log.action.startsWith(actionFilter)) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        log.action.toLowerCase().includes(q) ||
        log.entity_type.toLowerCase().includes(q) ||
        log.entity_id?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  /** 格式化时间 */
  function formatTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  }

  /** 操作类型的中文标签 */
  function actionLabel(action: string): string {
    try { return t(`actionLabels.${action}` as any); } catch { return action; }
  }

  /** 操作类型对应的 Badge 颜色 */
  function actionBadgeVariant(action: string) {
    if (action.startsWith("user")) return "secondary" as const;
    if (action.startsWith("team")) return "outline" as const;
    if (action.startsWith("project")) return "default" as const;
    if (action.startsWith("billing")) return "destructive" as const;
    return "outline" as const;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("auditLogs.title")}</h1>
          <p className="text-muted-foreground">{t("auditLogs.desc")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadLogs}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {t("auditLogs.refresh")}
        </Button>
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-wrap gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("auditLogs.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-36">
            <Filter className="mr-2 h-4 w-4" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("auditLogs.allActions")}</SelectItem>
            <SelectItem value="user">{t("auditLogs.filterUser")}</SelectItem>
            <SelectItem value="team">{t("auditLogs.filterTeam")}</SelectItem>
            <SelectItem value="project">{t("auditLogs.filterProject")}</SelectItem>
            <SelectItem value="billing">{t("auditLogs.filterBilling")}</SelectItem>
            <SelectItem value="settings">{t("auditLogs.filterSettings")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 日志列表 */}
      <Card>
        <CardHeader>
          <CardTitle>{t("auditLogs.pageTitle")}</CardTitle>
          <CardDescription>
            {t("auditLogs.totalRecords", { count: filteredLogs.length })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">{t("auditLogs.noLogs")}</div>
          ) : (
            <div className="space-y-2">
              {filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between rounded-lg border p-3 text-sm"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant={actionBadgeVariant(log.action)}>
                      {actionLabel(log.action)}
                    </Badge>
                    <div>
                      <p className="font-medium">
                        {log.entity_type}
                        {log.entity_id ? ` / ${log.entity_id.slice(0, 8)}...` : ""}
                      </p>
                      {log.metadata && Object.keys(log.metadata).length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {JSON.stringify(log.metadata).slice(0, 60)}
                          {JSON.stringify(log.metadata).length > 60 ? "..." : ""}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{log.user_id ? log.user_id.slice(0, 8) : "system"}</span>
                    <span>{formatTime(log.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
