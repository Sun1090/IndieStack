"use client";
/**
 * 项目封面上传表单（v0.5.0 B03）
 * 复用 storage 抽象与图片校验；仅 owner/admin 可提交（action 内守卫）。
 */

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { uploadProjectCover } from "@/lib/actions/uploads";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";

export function CoverUploadForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const t = useTranslations("dashboard.projects.detail");
  const tc = useTranslations("common");
  const ta = useTranslations("actions");
  const [uploading, setUploading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setUploading(true);
    const result = await uploadProjectCover(projectId, formData);
    setUploading(false);

    if (!result.ok) {
      toast({ title: tc("error"), description: ta(result.error), variant: "destructive" });
      return;
    }
    toast({ title: t("coverUpdated") });
    formRef.current?.reset();
    router.refresh();
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-2">
      <Label htmlFor="cover">{t("coverLabel")}</Label>
      <p className="text-sm text-muted-foreground">{t("coverDesc")}</p>
      <div className="flex items-center gap-2">
        <Input
          id="cover"
          name="cover"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="max-w-xs"
        />
        <Button type="submit" disabled={uploading}>
          {uploading ? t("coverUploading") : t("uploadCover")}
        </Button>
      </div>
    </form>
  );
}
