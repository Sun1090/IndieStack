/**
 * API 密钥管理页面
 * 创建、查看、吊销 API 密钥
 * 支持设置密钥名称和权限范围
 */

"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import { Key, Plus, Copy, Trash2, Check } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { createApiKey, listApiKeys, revokeApiKey, type ApiKeyRecord } from "@/lib/actions/api-keys";
import { useTranslations, useLocale } from "next-intl";
import { formatDate } from "@/lib/date";

export function ApiKeysPage() {
  const t = useTranslations("dashboard");
  const ta = useTranslations("actions");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyScope, setNewKeyScope] = useState("read");
  const [createdKeyValue, setCreatedKeyValue] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // 列表查询：缓存 + 内置加载态
  const { data: keys = [], isLoading: loading } = useQuery({
    queryKey: ["api-keys"],
    queryFn: async (): Promise<ApiKeyRecord[]> => {
      const result = await listApiKeys();
      if (result.error) {
        toast({
          title: t("apiKeys.loadError"),
          description: ta(result.error),
          variant: "destructive",
        });
        throw new Error(result.error);
      }
      return result.data;
    },
  });

  /** 创建成功后使列表缓存失效，自动重新拉取 */
  const createMutation = useMutation({
    mutationFn: async (input: { name: string; scope: "read" | "all" }) => {
      const result = await createApiKey(input);
      if (result.error) throw new Error(result.error);
      return result;
    },
    onSuccess: (result) => {
      setCreatedKeyValue(result.key ?? null);
      toast({ title: t("apiKeys.createSuccess"), description: t("apiKeys.createSuccessDesc") });
      void queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (err) => {
      toast({ title: t("apiKeys.createError"), description: ta(err.message), variant: "destructive" });
    },
    onSettled: () => {
      if (!createdKeyValue) setShowCreateDialog(false);
    },
  });

  /** 吊销密钥 */
  const revokeMutation = useMutation({
    mutationFn: async (keyId: string) => {
      const result = await revokeApiKey(keyId);
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => {
      toast({ title: t("apiKeys.revokeSuccess") });
      void queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (err) => {
      toast({ title: t("apiKeys.revokeError"), description: ta(err.message), variant: "destructive" });
    },
    onSettled: () => setRevokingId(null),
  });

  /** 创建新 API 密钥 */
  function handleCreate() {
    if (!newKeyName.trim()) {
      toast({ title: t("apiKeys.nameRequired"), variant: "destructive" });
      return;
    }
    createMutation.mutate({ name: newKeyName.trim(), scope: newKeyScope as "read" | "all" });
  }

  /** 吊销密钥 */
  function revokeKey(keyId: string) {
    setRevokingId(keyId);
    revokeMutation.mutate(keyId);
  }

  /** 复制到剪贴板 */
  async function copyToClipboard(val: string) {
    try {
      await navigator.clipboard.writeText(val);
      setCopied(true);
      toast({ title: t("apiKeys.copiedToast") });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 非安全上下文或权限被拒时给出明确反馈，避免静默失败
      toast({ title: t("apiKeys.copyFailed"), variant: "destructive" });
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader title={t("apiKeys.title")} description={t("apiKeys.desc")}>
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              {t("apiKeys.create")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            {createdKeyValue ? (
              <>
                <DialogHeader>
                  <DialogTitle>{t("apiKeys.createdTitle")}</DialogTitle>
                  <DialogDescription>{t("apiKeys.createdDesc")}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="rounded-lg border bg-muted p-3">
                    <code className="break-all text-sm">{createdKeyValue}</code>
                  </div>
                  <Button className="w-full" onClick={() => copyToClipboard(createdKeyValue)}>
                    {copied ? (
                      <>
                        <Check className="mr-2 h-4 w-4" /> {t("apiKeys.copied")}
                      </>
                    ) : (
                      <>
                        <Copy className="mr-2 h-4 w-4" /> {t("apiKeys.copy")}
                      </>
                    )}
                  </Button>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowCreateDialog(false);
                      setCreatedKeyValue(null);
                      setNewKeyName("");
                    }}
                  >
                    {t("apiKeys.close")}
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>{t("apiKeys.createDialogTitle")}</DialogTitle>
                  <DialogDescription>{t("apiKeys.createDialogDesc")}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t("apiKeys.nameLabel")}</label>
                    <Input
                      placeholder={t("apiKeys.namePlaceholder")}
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t("apiKeys.scopeLabel")}</label>
                    <Select value={newKeyScope} onValueChange={setNewKeyScope}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="read">{t("apiKeys.scopeRead")}</SelectItem>
                        <SelectItem value="all">{t("apiKeys.scopeAll")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                    {t("apiKeys.cancel")}
                  </Button>
                  <Button onClick={handleCreate} disabled={createMutation.isPending}>
                    {createMutation.isPending ? t("apiKeys.creating") : t("apiKeys.create")}
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            {t("apiKeys.listTitle")}
          </CardTitle>
          <CardDescription>{t("apiKeys.listDesc", { count: keys.length })}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : keys.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <Key className="h-12 w-12 text-muted-foreground/50" />
              <div>
                <p className="font-medium">{t("apiKeys.empty")}</p>
                <p className="text-sm text-muted-foreground">{t("apiKeys.emptyDesc")}</p>
              </div>
              <Button variant="outline" onClick={() => setShowCreateDialog(true)}>
                <Plus className="mr-2 h-4 w-4" />
                {t("apiKeys.create")}
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {keys.map((key) => (
                <div
                  key={key.id}
                  className="flex items-center justify-between py-4 first:pt-0 last:pb-0"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{key.name}</span>
                      <Badge variant={key.is_active ? "default" : "secondary"}>
                        {key.is_active ? t("apiKeys.active") : t("apiKeys.revoked")}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                        {key.key_prefix}
                      </code>
                      <span>
                        {key.last_used_at
                          ? t("apiKeys.lastUsed", {
                              date: formatDate(key.last_used_at, { locale }),
                            })
                          : t("apiKeys.neverUsed")}
                      </span>
                      <span>
                        {t("apiKeys.createdAt", { date: formatDate(key.created_at, { locale }) })}
                      </span>
                    </div>
                    {key.scopes && key.scopes.length > 0 && (
                      <div className="flex gap-1 pt-1">
                        {key.scopes.map((s: string) => (
                          <Badge key={s} variant="outline" className="text-xs">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {key.is_active && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={revokingId === key.id}
                        onClick={() => revokeKey(key.id)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {revokingId === key.id ? t("apiKeys.revoking") : t("apiKeys.revoke")}
                      </Button>
                    )}
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
