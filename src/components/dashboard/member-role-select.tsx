"use client";

/**
 * 成员角色选择器
 * owner/admin 可在 member ↔ admin 间切换；owner 角色受保护不可改
 */

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateMemberRole } from "@/lib/actions/team";
import { toast } from "@/hooks/use-toast";

interface MemberRoleSelectProps {
  memberId: string;
  currentRole: "admin" | "member";
  disabled?: boolean;
}

export function MemberRoleSelect({ memberId, currentRole, disabled }: MemberRoleSelectProps) {
  const t = useTranslations("dashboard.team.list");
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(currentRole);

  function handleChange(newRole: string) {
    const previous = value;
    setValue(newRole as "admin" | "member");
    startTransition(async () => {
      const result = await updateMemberRole(memberId, newRole as "admin" | "member");
      if (!result.ok) {
        setValue(previous);
        toast({ title: result.error, variant: "destructive" });
      }
    });
  }

  return (
    <Select value={value} onValueChange={handleChange} disabled={disabled || pending}>
      <SelectTrigger className="h-8 w-28" aria-label={t("changeRole")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="member">{t("roleMember")}</SelectItem>
        <SelectItem value="admin">{t("roleAdmin")}</SelectItem>
      </SelectContent>
    </Select>
  );
}
