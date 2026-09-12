"use client";
/**
 * 项目封面上传表单（v0.5.0 B03；v0.6.0 G08 进度/取消）
 * 同源 XHR 直传 Route Handler；仅 owner/admin 可提交（service 内守卫）。
 */

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UploadProgress } from "@/components/shared/upload-progress";
import { useFileUpload } from "@/hooks/use-file-upload";
import { toast } from "@/hooks/use-toast";
import { API_ROUTES } from "@/lib/constants";

export function CoverUploadForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const t = useTranslations("dashboard.projects.detail");
  const tc = useTranslations("common");
  const ta = useTranslations("actions");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const { uploading, progress, upload, cancel } = useFileUpload();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const file = formData.get("cover");
    if (!(file instanceof File)) return;

    const result = await upload({
      url: API_ROUTES.uploads.projectCover,
      fieldName: "cover",
      file,
      fields: { projectId },
    });

    if (!result.ok) {
      if (result.error === "uploadCancelled") {
        toast({ title: tc("cancelled"), description: ta("uploadCancelled") });
        return;
      }
      toast({ title: tc("error"), description: ta(result.error), variant: "destructive" });
      return;
    }
    toast({ title: t("coverUpdated") });
    formRef.current?.reset();
    setSelectedFile(null);
    router.refresh();
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-2">
      <Label htmlFor="cover">{t("coverLabel")}</Label>
      <p className="text-muted-foreground text-sm">{t("coverDesc")}</p>
      <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          id="cover"
          name="cover"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="w-full max-w-xs"
          disabled={uploading}
          onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
        />
        <Button type="submit" disabled={uploading || !selectedFile}>
          {uploading ? t("coverUploading") : t("uploadCover")}
        </Button>
      </div>
      {uploading ? (
        <UploadProgress
          value={progress}
          label={t("uploadProgress", { progress })}
          cancelLabel={tc("cancel")}
          onCancel={cancel}
        />
      ) : null}
    </form>
  );
}
