"use client";
/**
 * 头像上传表单（v0.5.0 B02；v0.6.0 G08 进度/取消）
 * 同源 XHR 直传 Route Handler，显示上传百分比并支持取消；service 复用 Action 的安全规则。
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

export function AvatarUploadForm() {
  const router = useRouter();
  const t = useTranslations("dashboard.profile.edit");
  const tc = useTranslations("common");
  const ta = useTranslations("actions");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const { uploading, progress, upload, cancel } = useFileUpload();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const file = formData.get("avatar");
    if (!(file instanceof File)) return;

    const result = await upload({
      url: API_ROUTES.uploads.avatar,
      fieldName: "avatar",
      file,
    });

    if (!result.ok) {
      if (result.error === "uploadCancelled") {
        toast({ title: tc("cancelled"), description: ta("uploadCancelled") });
        return;
      }
      toast({ title: tc("error"), description: ta(result.error), variant: "destructive" });
      return;
    }
    toast({ title: t("success") });
    formRef.current?.reset();
    setSelectedFile(null);
    router.refresh();
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-2">
      <Label htmlFor="avatar">{t("avatarLabel")}</Label>
      <p className="text-muted-foreground text-sm">{t("avatarDesc")}</p>
      <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          id="avatar"
          name="avatar"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="w-full max-w-xs"
          disabled={uploading}
          onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
        />
        <Button type="submit" disabled={uploading || !selectedFile}>
          {uploading ? t("saving") : t("uploadAvatar")}
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
