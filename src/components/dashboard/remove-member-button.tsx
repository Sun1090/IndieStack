"use client";
/**
 * 移除团队成员按钮组件
 * 使用 ConfirmDialog 组件进行确认交互，已接入国际化支持
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { removeMember } from "@/lib/actions/team";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { toast } from "@/hooks/use-toast";
import { useTranslations } from "next-intl";

interface RemoveMemberButtonProps {
  memberId: string;
}

export function RemoveMemberButton({ memberId }: RemoveMemberButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");
  const ta = useTranslations("actions");

  async function handleRemove() {
    setLoading(true);
    const result = await removeMember(memberId);

    if (result.error) {
      toast({ title: tc("failed"), description: ta(result.error), variant: "destructive" });
      setLoading(false);
      return;
    }

    toast({ title: t("team.list.removeMember") });
    router.refresh();
    setLoading(false);
  }

  return (
    <ConfirmDialog
      title={t("team.list.removeMember")}
      description={t("team.list.removeConfirm")}
      confirmText={tc("confirm")}
      cancelText={tc("cancel")}
      variant="destructive"
      onConfirm={handleRemove}
    >
      <Button
        variant="ghost"
        size="sm"
        disabled={loading}
        className="text-destructive hover:text-destructive"
      >
        {loading ? tc("loading") : t("team.list.removeMember")}
      </Button>
    </ConfirmDialog>
  );
}
