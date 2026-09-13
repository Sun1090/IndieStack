"use client";
/**
 * 修改密码表单组件
 * 包含当前密码、新密码、确认密码字段
 * 使用 Server Action 更新用户密码
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { updatePassword } from "@/lib/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, FormFieldControl } from "@/components/shared/form-field";
import { toast } from "@/hooks/use-toast";
import { PasswordStrength } from "@/components/shared/password-strength";

export function PasswordForm() {
  const router = useRouter();
  const t = useTranslations("dashboard.settings.sections.password");
  const tc = useTranslations("common");
  const ta = useTranslations("actions");
  const [loading, setLoading] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const result = await updatePassword(formData);

    if (!result.ok) {
      toast({ title: tc("error"), description: ta(result.error), variant: "destructive" });
      setLoading(false);
      return;
    }

    toast({ title: t("success"), description: t("successDesc") });
    (e.target as HTMLFormElement).reset();
    router.refresh();
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <FormField htmlFor="currentPassword" label={t("currentLabel")}>
        <FormFieldControl>
          <Input name="currentPassword" type="password" autoComplete="current-password" required />
        </FormFieldControl>
      </FormField>

      <FormField htmlFor="newPassword" label={t("newLabel")} description={t("hint")}>
        <FormFieldControl>
          <Input
            name="newPassword"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </FormFieldControl>
        <PasswordStrength password={newPassword} />
      </FormField>

      <Button type="submit" disabled={loading}>
        {loading ? t("saving") : t("submit")}
      </Button>
    </form>
  );
}
