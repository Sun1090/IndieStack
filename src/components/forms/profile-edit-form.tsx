"use client";
/**
 * 个人资料编辑表单组件
 * 包含姓名、简介、头像上传等字段
 * 提交后调用 Server Action 更新用户资料
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { updateProfileSettings } from "@/lib/actions/profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormFieldControl } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { toast } from "@/hooks/use-toast";

interface ProfileEditFormProps {
  fullName: string;
  bio: string;
  timezone: string;
  language: string;
}

export function ProfileEditForm({ fullName, bio, timezone, language }: ProfileEditFormProps) {
  const router = useRouter();
  const t = useTranslations("dashboard.profile.edit");
  const tv = useTranslations("dashboard.profile.view");
  const tc = useTranslations("common");
  const ta = useTranslations("actions");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const result = await updateProfileSettings(formData);

    if (!result.ok) {
      toast({ title: tc("error"), description: ta(result.error), variant: "destructive" });
      setLoading(false);
      return;
    }

    toast({ title: t("success") });
    router.refresh();
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <FormField htmlFor="fullName" label={t("nameLabel")}>
          <FormFieldControl>
            <Input
              name="fullName"
              defaultValue={fullName}
              placeholder={t("namePlaceholder")}
              required
            />
          </FormFieldControl>
        </FormField>
        <FormField htmlFor="timezone" label={t("timezoneLabel")} description={t("timezoneDesc")}>
          <FormFieldControl>
            <NativeSelect name="timezone" defaultValue={timezone}>
              <option value="UTC">UTC</option>
              <option value="Asia/Shanghai">Asia/Shanghai (CST)</option>
              <option value="America/New_York">America/New_York (EST)</option>
              <option value="America/Los_Angeles">America/Los_Angeles (PST)</option>
              <option value="Europe/London">Europe/London (GMT)</option>
              <option value="Europe/Berlin">Europe/Berlin (CET)</option>
              <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
              <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
            </NativeSelect>
          </FormFieldControl>
        </FormField>
      </div>

      <FormField htmlFor="bio" label={t("bioLabel")}>
        <FormFieldControl>
          <Textarea name="bio" defaultValue={bio} placeholder={t("bioPlaceholder")} rows={3} />
        </FormFieldControl>
      </FormField>

      <FormField htmlFor="language" label={t("languageLabel")} description={t("languageDesc")}>
        <FormFieldControl>
          <NativeSelect name="language" defaultValue={language}>
            {(["en", "zh", "ja", "ko"] as const).map((value) => (
              <option key={value} value={value}>
                {tv(`languages.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </FormFieldControl>
      </FormField>

      <Button type="submit" disabled={loading}>
        {loading ? t("saving") : t("submit")}
      </Button>
    </form>
  );
}
