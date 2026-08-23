"use client";

/**
 * 创建团队页面（客户端组件）
 * 通过 CreateTeamForm 提供团队创建表单
 * 已接入国际化支持
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createTeam } from "@/lib/actions/team";
import { createTeamSchema } from "@/lib/validations/team";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { useTranslations } from "next-intl";

export function CreateTeamPage() {
  const router = useRouter();
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");
  const ta = useTranslations("actions");
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  function handleNameChange(value: string) {
    setName(value);
    setSlug(
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 50),
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const parsed = createTeamSchema.safeParse({ name, slug });
    if (!parsed.success) {
      toast({
        title: tc("error"),
        description: ta(parsed.error.issues[0].message),
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    const result = await createTeam(parsed.data);
    if (!result.ok) {
      toast({ title: tc("error"), description: ta(result.error), variant: "destructive" });
      setLoading(false);
      return;
    }

    toast({ title: t("team.create.success"), description: "" });
    router.push(ROUTES.dashboardTeam);
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={ROUTES.dashboardTeam}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <PageHeader title={t("team.create.title")} description={t("team.create.desc")} />
      </div>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>{t("team.create.title")}</CardTitle>
          <CardDescription>{t("team.create.desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t("team.create.nameLabel")}</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder={t("team.create.namePlaceholder")}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug">{t("team.create.slugLabel")}</Label>
              <Input
                id="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder={t("team.create.slugPlaceholder")}
                required
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? tc("loading") : t("team.create.submit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
