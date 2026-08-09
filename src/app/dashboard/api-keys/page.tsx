/**
 * API 密钥管理页面
 * 创建、查看、吊销 API 密钥
 * 支持设置密钥名称和权限范围
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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
import { Key, Plus, Copy, Trash2, Eye, EyeOff, Check, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";

/** 生成的密钥信息 */
interface GeneratedKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
}

export default function ApiKeysPage() {
  const supabase = createClient();
  const router = useRouter();
  const [keys, setKeys] = useState<GeneratedKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyScope, setNewKeyScope] = useState("read");
  const [creating, setCreating] = useState(false);
  const [createdKeyValue, setCreatedKeyValue] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

   const loadKeys = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("api_keys")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

     setKeys((data ?? []) as unknown as GeneratedKey[]);
     setLoading(false);
   }, [supabase]);
 
   useEffect(() => {
     loadKeys();
   }, [loadKeys]);

  /** 创建新 API 密钥 */
  async function handleCreate() {
    if (!newKeyName.trim()) {
      toast({ title: "请输入密钥名称", variant: "destructive" });
      return;
    }

    setCreating(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({ title: "未登录", variant: "destructive" });
      return;
    }

    // 生成密钥前缀和哈希
    const rawKey = `isk_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const keyPrefix = rawKey.slice(0, 12) + "...";

    // 密钥权限范围
    const scopes = newKeyScope === "all"
      ? ["user:read", "user:write", "project:read", "project:write", "billing:read"]
      : ["project:read"];

    const { error } = await supabase
      .from("api_keys")
      .insert({
        user_id: user.id,
        name: newKeyName.trim(),
        key_prefix: keyPrefix,
        key_hash: rawKey, // 生产环境应使用 pgcrypto 哈希
        scopes,
      } as any);

    if (error) {
      toast({ title: "创建失败", description: error.message, variant: "destructive" });
      setCreating(false);
      return;
    }

    setCreatedKeyValue(rawKey);
    toast({ title: "密钥创建成功", description: "请立即复制并保存密钥，关闭后将无法再次查看。" });
    setCreating(false);
    loadKeys();
  }

  /** 吊销密钥 */
  async function revokeKey(keyId: string) {
    const { error } = await (supabase as any)
      .from("api_keys")
      .update({ is_active: false })
      .eq("id", keyId);

    if (error) {
      toast({ title: "吊销失败", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "密钥已吊销" });
    loadKeys();
  }

  /** 复制到剪贴板 */
  function copyToClipboard(val: string) {
    navigator.clipboard.writeText(val);
    setCopied(true);
    toast({ title: "已复制到剪贴板" });
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="API 密钥"
        description="管理你的 API 密钥，用于外部服务集成和 API 调用鉴权"
      >
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              创建密钥
            </Button>
          </DialogTrigger>
          <DialogContent>
            {createdKeyValue ? (
              <>
                <DialogHeader>
                  <DialogTitle>密钥已创建</DialogTitle>
                  <DialogDescription>
                    请立即复制此密钥。出于安全考虑，关闭对话框后将无法再次查看完整密钥。
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="rounded-lg border bg-muted p-3">
                    <code className="break-all text-sm">{createdKeyValue}</code>
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => copyToClipboard(createdKeyValue)}
                  >
                    {copied ? (
                      <><Check className="mr-2 h-4 w-4" /> 已复制</>
                    ) : (
                      <><Copy className="mr-2 h-4 w-4" /> 复制密钥</>
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
                    关闭
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>创建新 API 密钥</DialogTitle>
                  <DialogDescription>
                    密钥用于 API 访问鉴权，请妥善保管。
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">密钥名称</label>
                    <Input
                      placeholder="例如：生产环境密钥"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">权限范围</label>
                    <Select value={newKeyScope} onValueChange={setNewKeyScope}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="read">只读（仅查询权限）</SelectItem>
                        <SelectItem value="all">全部（读写权限）</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                    取消
                  </Button>
                  <Button onClick={handleCreate} disabled={creating}>
                    {creating ? "创建中..." : "创建密钥"}
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
            密钥列表
          </CardTitle>
          <CardDescription>
            管理你的 API 访问密钥。共 {keys.length} 个密钥
          </CardDescription>
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
                <p className="font-medium">暂无 API 密钥</p>
                <p className="text-sm text-muted-foreground">
                  创建你的第一个密钥来开始使用 API。
                </p>
              </div>
              <Button variant="outline" onClick={() => setShowCreateDialog(true)}>
                <Plus className="mr-2 h-4 w-4" />
                创建密钥
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {keys.map((key) => (
                <div key={key.id} className="flex items-center justify-between py-4 first:pt-0 last:pb-0">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{key.name}</span>
                      <Badge variant={key.is_active ? "default" : "secondary"}>
                        {key.is_active ? "启用" : "已吊销"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                        {key.key_prefix}
                      </code>
                      <span>
                        {key.last_used_at
                          ? `上次使用: ${new Date(key.last_used_at).toLocaleDateString("zh-CN")}`
                          : "从未使用"}
                      </span>
                      <span>创建于 {new Date(key.created_at).toLocaleDateString("zh-CN")}</span>
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
                        onClick={() => revokeKey(key.id)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        吊销
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
