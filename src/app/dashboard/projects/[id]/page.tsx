/**
 * 项目详情页面
 * 查看单个项目的概览、成员和设置
 * 已接入国际化支持
 */

export const dynamic = "force-dynamic";

import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ROUTES } from "@/lib/constants";
import { PageHeader } from "@/components/shared/page-header";
import { ArrowLeft, FolderKanban, GitBranch, Clock, Globe, Activity, CheckCircle2, XCircle } from "lucide-react";

interface ProjectData {
  id: string; name: string; description: string; status: string; lastDeployed: string;
  branch: string; domain: string | null; framework: string; region: string;
  envVars: number; storage: string;
  deployments: { id: string; status: string; message: string; time: string; branch: string }[];
}

const mockProjects: Record<string, ProjectData> = {
  proj_1: {
    id: "proj_1", name: "api-service", description: "Core REST API service", status: "active",
    lastDeployed: "2 hours ago", branch: "main", domain: "api.example.com",
    framework: "Next.js", region: "us-east-1", envVars: 12, storage: "256 MB",
    deployments: [
      { id: "d1", status: "success", message: "Update authentication middleware", time: "2 hours ago", branch: "main" },
      { id: "d2", status: "success", message: "Add rate limiting", time: "1 day ago", branch: "main" },
      { id: "d3", status: "failed", message: "Database migration v2", time: "2 days ago", branch: "staging" },
      { id: "d4", status: "success", message: "Initial deployment", time: "1 week ago", branch: "main" },
    ],
  },
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("dashboard");
  return { title: `${t("projects.detail.metaTitle")} - ${id}`, description: t("projects.detail.metaDesc") };
}

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("dashboard");
  const project = mockProjects[id];

  if (!project) { notFound(); }

  return (
    <div className="space-y-8">
      <PageHeader title={project.name} description={project.description}>
        <Button variant="outline" asChild>
          <Link href={ROUTES.dashboardProjects}>
            <ArrowLeft className="mr-2 h-4 w-4" /> {t("projects.detail.backToProjects")}
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{t("projects.detail.overview")}</CardTitle></CardHeader>
          <CardContent><Badge variant={project.status === "active" ? "default" : "secondary"}>{project.status}</Badge></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Framework</CardTitle></CardHeader>
          <CardContent><p className="text-lg font-semibold">{project.framework}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Domain</CardTitle></CardHeader>
          <CardContent>
            {project.domain ? (
              <a href={`https://${project.domain}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm text-primary hover:underline">
                <Globe className="h-3.5 w-3.5" /> {project.domain}
              </a>
            ) : (<p className="text-sm text-muted-foreground">Not configured</p>)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{t("projects.detail.overview")}</CardTitle></CardHeader>
          <CardContent><p className="flex items-center gap-1 text-sm"><Clock className="h-3.5 w-3.5 text-muted-foreground" />{project.lastDeployed}</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>{t("projects.detail.overview")}</CardTitle><CardDescription>{t("projects.detail.metaDesc")}</CardDescription></CardHeader>
        <CardContent>
          <div className="space-y-4">
            {project.deployments.map((deployment) => (
              <div key={deployment.id} className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0">
                <div className="flex items-start gap-3">
                  {deployment.status === "success" ? (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 text-green-500 shrink-0" />
                  ) : (
                    <XCircle className="mt-0.5 h-5 w-5 text-red-500 shrink-0" />
                  )}
                  <div>
                    <p className="text-sm font-medium">{deployment.message}</p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="flex items-center gap-1 text-xs text-muted-foreground"><GitBranch className="h-3 w-3" />{deployment.branch}</span>
                      <span className="text-xs text-muted-foreground">{deployment.time}</span>
                    </div>
                  </div>
                </div>
                <Badge variant="outline" className={deployment.status === "success" ? "text-green-500 border-green-500/30" : "text-red-500 border-red-500/30"}>
                  {deployment.status === "success" ? "Success" : "Failed"}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("projects.detail.settings")}</CardTitle><CardDescription>{t("projects.detail.metaDesc")}</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><p className="text-sm font-medium text-muted-foreground">Project ID</p><p className="text-sm font-mono">{project.id}</p></div>
            <div><p className="text-sm font-medium text-muted-foreground">Region</p><p className="text-sm">{project.region}</p></div>
            <div><p className="text-sm font-medium text-muted-foreground">Environment Variables</p><p className="text-sm">{project.envVars} configured</p></div>
            <div><p className="text-sm font-medium text-muted-foreground">Storage Used</p><p className="text-sm">{project.storage}</p></div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
