"use client";
/**
 * 邀请团队成员表单组件
 * 输入成员邮箱和选择角色，发送邀请
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { inviteMember } from "@/lib/actions/team";
import { ROUTES } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, FormFieldControl } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { toast } from "@/hooks/use-toast";

export function InviteMemberForm() {
  const router = useRouter();
  const t = useTranslations("dashboard.team.invite");
  const tc = useTranslations("common");
  const ta = useTranslations("actions");
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const result = await inviteMember({ email, role });

    if (!result.ok) {
      toast({ title: tc("error"), description: ta(result.error), variant: "destructive" });
      setLoading(false);
      return;
    }

    toast({ title: t("success"), description: t("successDesc", { email }) });
    router.push(ROUTES.dashboardTeam);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <FormField htmlFor="email" label={t("emailLabel")}>
        <FormFieldControl>
          <Input
            type="email"
            placeholder={t("emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </FormFieldControl>
      </FormField>

      <FormField htmlFor="role" label={t("roleLabel")}>
        <FormFieldControl>
          <NativeSelect
            value={role}
            onChange={(e) => setRole(e.target.value as "member" | "admin")}
          >
            <option value="member">{t("roleMember")}</option>
            <option value="admin">{t("roleAdmin")}</option>
          </NativeSelect>
        </FormFieldControl>
      </FormField>

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? t("saving") : t("submit")}
      </Button>
    </form>
  );
}
