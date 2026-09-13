"use client";

/**
 * 项目设置表单：重命名 / 修改描述
 */

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, FormFieldControl } from "@/components/shared/form-field";
import { toast } from "@/hooks/use-toast";
import { updateProject } from "@/lib/actions/projects";

interface ProjectSettingsFormProps {
  projectId: string;
  name: string;
  description: string;
  config?: { branch?: string; domain?: string; framework?: string; region?: string };
}

export function ProjectSettingsForm({
  projectId,
  name,
  description,
  config = {},
}: ProjectSettingsFormProps) {
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
        config: {
          branch: String(form.get("branch") ?? ""),
          domain: String(form.get("domain") ?? ""),
          framework: String(form.get("framework") ?? ""),
          region: String(form.get("region") ?? ""),
        },
      });
      if (!result.ok) {
        toast({ title: tc("error"), description: result.error, variant: "destructive" });
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormField htmlFor="project-name" label={t("detail.nameLabel")}>
        <FormFieldControl>
          <Input name="name" defaultValue={name} required minLength={1} />
        </FormFieldControl>
      </FormField>
      <FormField htmlFor="project-desc" label={t("detail.descLabel")}>
        <FormFieldControl>
          <Input name="description" defaultValue={description} />
        </FormFieldControl>
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField htmlFor="cfg-branch" label={t("detail.branchLabel")}>
          <FormFieldControl>
            <Input name="branch" defaultValue={config.branch ?? ""} placeholder="main" />
          </FormFieldControl>
        </FormField>
        <FormField htmlFor="cfg-domain" label={t("detail.domainLabel")}>
          <FormFieldControl>
            <Input name="domain" defaultValue={config.domain ?? ""} placeholder="app.example.com" />
          </FormFieldControl>
        </FormField>
        <FormField htmlFor="cfg-framework" label={t("detail.frameworkLabel")}>
          <FormFieldControl>
            <Input name="framework" defaultValue={config.framework ?? ""} placeholder="Next.js" />
          </FormFieldControl>
        </FormField>
        <FormField htmlFor="cfg-region" label={t("detail.regionLabel")}>
          <FormFieldControl>
            <Input name="region" defaultValue={config.region ?? ""} placeholder="hkg1" />
          </FormFieldControl>
        </FormField>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? tc("loading") : tc("save")}
      </Button>
    </form>
  );
}
