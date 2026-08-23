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
import { Label } from "@/components/ui/label";
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
        <div className="space-y-2">
          <Label htmlFor="fullName">{t("nameLabel")}</Label>
          <Input
            id="fullName"
            name="fullName"
            defaultValue={fullName}
            placeholder={t("namePlaceholder")}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="timezone">{t("timezoneLabel")}</Label>
          <select
            id="timezone"
            name="timezone"
            defaultValue={timezone}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="UTC">UTC</option>
            <option value="Asia/Shanghai">Asia/Shanghai (CST)</option>
            <option value="America/New_York">America/New_York (EST)</option>
            <option value="America/Los_Angeles">America/Los_Angeles (PST)</option>
            <option value="Europe/London">Europe/London (GMT)</option>
            <option value="Europe/Berlin">Europe/Berlin (CET)</option>
            <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
            <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="bio">{t("bioLabel")}</Label>
        <Textarea
          id="bio"
          name="bio"
          defaultValue={bio}
          placeholder={t("bioPlaceholder")}
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="language">{t("languageLabel")}</Label>
        <select
          id="language"
          name="language"
          defaultValue={language}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {(["en", "zh", "ja", "ko"] as const).map((value) => (
            <option key={value} value={value}>
              {tv(`languages.${value}`)}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit" disabled={loading}>
        {loading ? t("saving") : t("submit")}
      </Button>
    </form>
  );
}
