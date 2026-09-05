"use client";
/**
 * 头像上传表单（v0.5.0 B02）
 * 独立于资料主表单：选择图片即上传（uploadAvatar action），
 * 成功后刷新路由展示新头像；错误经 actions 命名空间翻译。
 */

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { uploadAvatar } from "@/lib/actions/uploads";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";

export function AvatarUploadForm() {
  const router = useRouter();
  const t = useTranslations("dashboard.profile.edit");
  const tc = useTranslations("common");
  const ta = useTranslations("actions");
  const [uploading, setUploading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setUploading(true);
    const result = await uploadAvatar(formData);
    setUploading(false);

    if (!result.ok) {
      toast({ title: tc("error"), description: ta(result.error), variant: "destructive" });
      return;
    }
    toast({ title: t("success") });
    formRef.current?.reset();
    router.refresh();
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-2">
      <Label htmlFor="avatar">{t("avatarLabel")}</Label>
      <p className="text-sm text-muted-foreground">{t("avatarDesc")}</p>
      <div className="flex items-center gap-2">
        <Input
          id="avatar"
          name="avatar"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="max-w-xs"
        />
        <Button type="submit" disabled={uploading}>
          {uploading ? t("saving") : t("uploadAvatar")}
        </Button>
      </div>
    </form>
  );
}
