/**
 * 用户管理页面（仅限 admin / super_admin）
 * 查看平台所有用户、搜索、修改角色、禁用账户
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Search, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { listAdminUsers, updateUserRole as updateAdminUserRole, type AdminUser } from "@/lib/actions/admin";

export default function AdminUsersPage() {
  const t = useTranslations("admin");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  /** 加载用户列表 */
  const loadUsers = useCallback(async () => {
    setLoading(true);
    const result = await listAdminUsers();
    if (!result.success) {
      toast({ title: t("users.updateFailed"), description: result.error, variant: "destructive" });
    } else {
      setUsers(result.data);
    }
    setLoading(false);
  }, [t]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  /** 更新用户角色 */
  async function updateUserRole(userId: string, newRole: string) {
    const result = await updateAdminUserRole(userId, newRole as "member" | "admin" | "viewer");

    if (!result.success) {
      toast({ title: t("users.updateFailed"), description: result.error, variant: "destructive" });
      return;
    }

    const roleLabel = t(`roleLabels.${newRole}` as any);
    toast({ title: t("users.updateSuccess"), description: t("users.updateSuccessDesc", { roleLabel }) });
    loadUsers();
  }

  /** 搜索过滤 */
  const filteredUsers = users.filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.full_name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q) ||
      u.role.includes(q)
    );
  });

  /** 角色对应的 Badge 颜色 */
  const roleBadgeVariant = (role: string) => {
    switch (role) {
      case "super_admin": return "default" as const;
      case "admin": return "secondary" as const;
      case "member": return "outline" as const;
      case "viewer": return "destructive" as const;
      default: return "outline" as const;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("users.title")}</h1>
        <p className="text-muted-foreground">{t("users.desc")}</p>
      </div>

      {/* 搜索栏 */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={t("users.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* 用户表格 */}
      <Card>
        <CardHeader>
          <CardTitle>{t("users.userList")}</CardTitle>
          <CardDescription>
            {t("users.totalUsers", { count: filteredUsers.length })}
            {search ? t("users.filteredSuffix") : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              {search ? t("users.noMatch") : t("users.noUsers")}
            </div>
          ) : (
            <div className="divide-y">
              {filteredUsers.map((user) => (
                <div key={user.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback>
                        {user.full_name?.charAt(0)?.toUpperCase() ?? user.email?.charAt(0)?.toUpperCase() ?? "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium leading-none">
                        {user.full_name || t("users.nameNotSet")}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{user.email}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t("users.registeredAt", { date: new Date(user.created_at).toLocaleDateString() })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={roleBadgeVariant(user.role)}>
                      {t(`roleLabels.${user.role}` as any)}
                    </Badge>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>{t("users.changeRole")}</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {(["member", "admin", "viewer"] as const).map((r) => (
                          <DropdownMenuItem
                            key={r}
                            disabled={user.role === r}
                            onClick={() => updateUserRole(user.id, r)}
                          >
                            {t(`roleLabels.${r}` as any)}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
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
