"use client";

/**
 * 新建项目页面
 * 通过 createProject Server Action 创建项目
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createProject } from "@/lib/actions/projects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";
import { ROUTES } from "@/lib/constants";

export function CreateProjectPage() {
  const router = useRouter();
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");
  const ta = useTranslations("actions");
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");

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

    const result = await createProject({ name, slug, description });
    if (result.error) {
      toast({ title: tc("error"), description: ta(result.error), variant: "destructive" });
      setLoading(false);
      return;
    }

    toast({ title: t("projects.create.success") });
    router.push(ROUTES.dashboardProjects);
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={ROUTES.dashboardProjects}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <PageHeader title={t("projects.create.title")} description={t("projects.create.desc")} />
      </div>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>{t("projects.create.title")}</CardTitle>
          <CardDescription>{t("projects.create.desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t("projects.create.nameLabel")}</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder={t("projects.create.namePlaceholder")}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug">{t("projects.create.slugLabel")}</Label>
              <Input
                id="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder={t("projects.create.slugPlaceholder")}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">{t("projects.create.descriptionLabel")}</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("projects.create.descriptionPlaceholder")}
                rows={4}
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? tc("loading") : t("projects.create.submit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
