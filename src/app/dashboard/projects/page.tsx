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
import { EmptyState } from "@/components/shared/empty-state";
import { FolderKanban, Plus, ExternalLink, GitBranch, Clock } from "lucide-react";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("projects.list.metaTitle"), description: t("projects.list.metaDesc") };
}

const mockProjects = [
  { id: "proj_1", name: "api-service", description: "Core REST API service", status: "active", lastDeployed: "2 hours ago", branch: "main", domain: "api.example.com" },
  { id: "proj_2", name: "web-app", description: "Main web application", status: "active", lastDeployed: "5 hours ago", branch: "main", domain: "app.example.com" },
  { id: "proj_3", name: "docs-site", description: "Documentation website", status: "draft", lastDeployed: "1 day ago", branch: "staging", domain: null },
  { id: "proj_4", name: "admin-panel", description: "Internal admin dashboard", status: "active", lastDeployed: "3 days ago", branch: "main", domain: "admin.example.com" },
];

export default async function ProjectsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const t = await getTranslations("dashboard");

  const projects = mockProjects;

  return (
    <div className="space-y-8">
      <PageHeader title={t("projects.list.title")} description={t("projects.list.desc")}>
        <Button asChild>
          <Link href="#">
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
              <Link href="#"><Plus className="mr-2 h-4 w-4" /> {t("projects.list.create")}</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {projects.map((project) => (
            <Link key={project.id} href={`/dashboard/projects/${project.id}`}>
              <Card className="transition-colors hover:border-primary/50 h-full cursor-pointer">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <FolderKanban className="h-4 w-4 text-muted-foreground" />
                        {project.name}
                      </CardTitle>
                      <CardDescription className="mt-1">{project.description}</CardDescription>
                    </div>
                    <Badge variant={project.status === "active" ? "default" : "secondary"}>
                      {project.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <GitBranch className="h-3.5 w-3.5" /> {project.branch}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" /> {project.lastDeployed}
                    </span>
                    {project.domain && (
                      <span className="flex items-center gap-1">
                        <ExternalLink className="h-3.5 w-3.5" /> {project.domain}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
