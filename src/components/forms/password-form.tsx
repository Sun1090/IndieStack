"use client";
/**
 * 修改密码表单组件
 * 包含当前密码、新密码、确认密码字段
 * 使用 Server Action 更新用户密码
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { updatePassword } from "@/lib/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";

export function PasswordForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const result = await updatePassword(formData);

    if (result.error) {
      toast({ title: "Error", description: result.error, variant: "destructive" });
      setLoading(false);
      return;
    }

    toast({ title: "Password updated", description: "Your password has been changed successfully." });
    (e.target as HTMLFormElement).reset();
    router.refresh();
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="currentPassword">Current Password</Label>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="newPassword">New Password</Label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <p className="text-xs text-muted-foreground">Must be at least 8 characters.</p>
      </div>

      <Button type="submit" disabled={loading}>
        {loading ? "Updating..." : "Update Password"}
      </Button>
    </form>
  );
}
