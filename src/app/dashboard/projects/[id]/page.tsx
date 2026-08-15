/**
 * 项目详情页面
 * 查看单个项目的概览和设置
 * 数据来自 projects 表，已接入国际化支持
 */

export const dynamic = "force-dynamic";

import { getTranslations, getLocale } from "next-intl/server";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants";
import { PageHeader } from "@/components/shared/page-header";
import { ArrowLeft, FolderKanban, GitBranch, Clock, Globe, Settings2 } from "lucide-react";
import { formatRelativeTime } from "@/lib/date";
import type { Database } from "@/lib/supabase/database.types";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("dashboard");
  return { title: `${t("projects.detail.metaTitle")} - ${id}`, description: t("projects.detail.metaDesc") };
}

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("dashboard");
  const locale = await getLocale();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: membership } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", user!.id)
    .limit(1)
    .maybeSingle() as unknown as { data: { team_id: string } | null; error: null };

  if (!membership) notFound();

  const { data: row } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .eq("team_id", membership.team_id)
    .maybeSingle() as unknown as { data: Database["public"]["Tables"]["projects"]["Row"] | null; error: null };

  if (!row) notFound();

  const config = (row.config ?? {}) as Record<string, unknown>;
  const branch = typeof config.branch === "string" ? config.branch : null;
  const domain = typeof config.domain === "string" ? config.domain : null;
  const framework = typeof config.framework === "string" ? config.framework : "—";
  const region = typeof config.region === "string" ? config.region : "—";

  return (
    <div className="space-y-8">
      <PageHeader title={row.name} description={row.description || t("projects.detail.metaDesc")}>
        <Button variant="outline" asChild>
          <Link href={ROUTES.dashboardProjects}>
            <ArrowLeft className="mr-2 h-4 w-4" /> {t("projects.detail.backToProjects")}
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{t("projects.detail.overview")}</CardTitle></CardHeader>
          <CardContent><Badge variant={row.status === "active" ? "default" : "secondary"}>{row.status}</Badge></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{t("projects.detail.labels.framework")}</CardTitle></CardHeader>
          <CardContent><p className="text-lg font-semibold">{framework}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{t("projects.detail.labels.domain")}</CardTitle></CardHeader>
          <CardContent>
            {domain ? (
              <a href={`https://${domain}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm text-primary hover:underline">
                <Globe className="h-3.5 w-3.5" /> {domain}
              </a>
            ) : (<p className="text-sm text-muted-foreground">{t("projects.detail.labels.notConfigured")}</p>)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{t("projects.detail.labels.created")}</CardTitle></CardHeader>
          <CardContent><p className="flex items-center gap-1 text-sm"><Clock className="h-3.5 w-3.5 text-muted-foreground" />{formatRelativeTime(row.created_at, { locale })}</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderKanban className="h-5 w-5 text-muted-foreground" />
            {t("projects.detail.overview")}
          </CardTitle>
          <CardDescription>{row.description || t("projects.detail.metaDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm font-medium text-muted-foreground">{t("projects.detail.labels.status")}</p>
              <p className="text-sm capitalize">{row.status}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">{t("projects.detail.labels.branch")}</p>
              <p className="flex items-center gap-1 text-sm">
                <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                {branch ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">{t("projects.detail.labels.visibility")}</p>
              <p className="text-sm">{row.visibility}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">{t("projects.detail.labels.region")}</p>
              <p className="text-sm">{region}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-muted-foreground" />
            {t("projects.detail.settings")}
          </CardTitle>
          <CardDescription>{t("projects.detail.metaDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><p className="text-sm font-medium text-muted-foreground">{t("projects.detail.labels.projectId")}</p><p className="text-sm font-mono">{row.id}</p></div>
            <div><p className="text-sm font-medium text-muted-foreground">{t("projects.detail.labels.slug")}</p><p className="text-sm font-mono">{row.slug}</p></div>
            <div><p className="text-sm font-medium text-muted-foreground">{t("projects.detail.labels.createdBy")}</p><p className="text-sm font-mono">{row.created_by ?? "—"}</p></div>
            <div><p className="text-sm font-medium text-muted-foreground">{t("projects.detail.labels.lastUpdated")}</p><p className="text-sm">{formatRelativeTime(row.updated_at, { locale })}</p></div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
