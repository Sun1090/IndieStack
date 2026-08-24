/**
 * 项目列表页面
 * 显示用户所有项目的列表，支持新建项目
 * 已接入国际化支持
 */

export const dynamic = "force-dynamic";

import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants";
import { PageHeader } from "@/components/shared/page-header";
import { ProjectDeleteButton } from "@/components/dashboard/project-delete-button";
import { EmptyState } from "@/components/shared/empty-state";
import { FolderKanban, Plus, ExternalLink, GitBranch, Clock } from "lucide-react";
import { getLocale } from "next-intl/server";
import { formatRelativeTime } from "@/lib/date";
import type { Database } from "@/lib/supabase/database.types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("projects.list.metaTitle"), description: t("projects.list.metaDesc") };
}

export default async function ProjectsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const t = await getTranslations("dashboard");
  const locale = await getLocale();

  const { data: membership } = (await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", user!.id)
    .limit(1)
    .maybeSingle()) as unknown as { data: { team_id: string } | null; error: null };

  const { data: projectRows } = membership
    ? await supabase
        .from("projects")
        .select("*")
        .eq("team_id", membership.team_id)
        .order("created_at", { ascending: false })
    : { data: [] };

  const projects = (projectRows ??
    []) as unknown as Database["public"]["Tables"]["projects"]["Row"][];

  function getProjectConfig(project: Database["public"]["Tables"]["projects"]["Row"]) {
    const config = project.config as Record<string, unknown> | null;
    return {
      branch: typeof config?.branch === "string" ? config.branch : null,
      domain: typeof config?.domain === "string" ? config.domain : null,
    };
  }

  return (
    <div className="space-y-8">
      <PageHeader title={t("projects.list.title")} description={t("projects.list.desc")}>
        <Button asChild>
          <Link href={ROUTES.dashboardProjectsNew}>
            <Plus className="mr-2 h-4 w-4" /> {t("projects.list.create")}
          </Link>
        </Button>
      </PageHeader>

      {projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={t("projects.list.noProjects")}
          description={t("projects.list.createFirst")}
          action={
            <Button asChild>
              <Link href={ROUTES.dashboardProjectsNew}>
                <Plus className="mr-2 h-4 w-4" /> {t("projects.list.create")}
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {projects.map((project) => (
            <div key={project.id} className="group relative">
              <Link href={`/dashboard/projects/${project.id}`} className="absolute inset-0 z-10" aria-label={project.name} />
              <Card className="h-full transition-colors group-hover:border-primary/50">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2 pr-8">
                        <FolderKanban className="h-4 w-4 text-muted-foreground" />
                        {project.name}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {project.description || "—"}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant={project.status === "active" ? "default" : "secondary"}>
                        {project.status}
                      </Badge>
                      <ProjectDeleteButton
                        projectId={String(project.id)}
                        projectName={String(project.name)}
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                    {(() => {
                      const config = getProjectConfig(project);
                      return (
                        <>
                          {config.branch && (
                            <span className="flex items-center gap-1">
                              <GitBranch className="h-3.5 w-3.5" /> {config.branch}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />{" "}
                            {formatRelativeTime(project.created_at, { locale })}
                          </span>
                          {config.domain && (
                            <span className="flex items-center gap-1">
                              <ExternalLink className="h-3.5 w-3.5" /> {config.domain}
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
