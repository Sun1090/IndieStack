"use client";

/**
 * 项目设置表单：重命名 / 修改描述
 */

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { updateProject } from "@/lib/actions/projects";

interface ProjectSettingsFormProps {
  projectId: string;
  name: string;
  description: string;
}

export function ProjectSettingsForm({ projectId, name, description }: ProjectSettingsFormProps) {
  const t = useTranslations("dashboard.projects");
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateProject(projectId, {
        name: String(form.get("name") ?? "").trim(),
        description: String(form.get("description") ?? ""),
      });
      if (!result.ok) {
        toast({ title: tc("error"), description: result.error, variant: "destructive" });
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="project-name">{t("detail.nameLabel")}</Label>
        <Input id="project-name" name="name" defaultValue={name} required minLength={1} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="project-desc">{t("detail.descLabel")}</Label>
        <Input id="project-desc" name="description" defaultValue={description} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? tc("loading") : tc("save")}
      </Button>
    </form>
  );
}
