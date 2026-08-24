"use client";

/**
 * 项目删除按钮
 * ConfirmDialog 二次确认 → deleteProject Action → 路由刷新
 */

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { deleteProject } from "@/lib/actions/projects";
import { toast } from "@/hooks/use-toast";

interface ProjectDeleteButtonProps {
  projectId: string;
  projectName: string;
}

export function ProjectDeleteButton({ projectId, projectName }: ProjectDeleteButtonProps) {
  const t = useTranslations("dashboard.projects");
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await deleteProject(projectId);
      if (!result.ok) {
        toast({ title: tc("error"), description: result.error, variant: "destructive" });
        return;
      }
      toast({ title: t("deleted") });
    });
  }

  return (
    <ConfirmDialog
      title={t("confirmTitle")}
      description={t("confirmDesc")}
      confirmText={t("delete")}
      cancelText={tc("cancel")}
      variant="destructive"
      onConfirm={handleConfirm}
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-destructive"
        disabled={pending}
        aria-label={`${t("delete")}: ${projectName}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </ConfirmDialog>
  );
}
