"use client";
/**
 * 邀请团队成员表单组件
 * 输入成员邮箱和选择角色，发送邀请
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { inviteMember } from "@/lib/actions/team";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

    if (result.error) {
      toast({ title: tc("error"), description: ta(result.error), variant: "destructive" });
      setLoading(false);
      return;
    }

    toast({ title: t("success"), description: t("successDesc", { email }) });
    router.push("/dashboard/team");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="email">{t("emailLabel")}</Label>
        <Input
          id="email"
          type="email"
          placeholder={t("emailPlaceholder")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="role">{t("roleLabel")}</Label>
        <select
          id="role"
          value={role}
          onChange={(e) => setRole(e.target.value as "member" | "admin")}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <option value="member">{t("roleMember")}</option>
          <option value="admin">{t("roleAdmin")}</option>
        </select>
      </div>

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? t("saving") : t("submit")}
      </Button>
    </form>
  );
}
