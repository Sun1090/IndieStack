/**
 * 团队管理页面
 * 查看和管理团队成员列表及角色权限
 * 已接入国际化支持
 */

export const dynamic = "force-dynamic";

import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Users, Plus } from "lucide-react";
import { RemoveMemberButton } from "@/components/dashboard/remove-member-button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("team.list.metaTitle"), description: t("team.list.metaDesc") };
}

export default async function TeamPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const t = await getTranslations("dashboard");

  const { data: membership } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", user!.id)
    .limit(1)
    .single() as unknown as { data: { team_id: string } | null };

  if (!membership) {
    return (
      <div className="space-y-8">
        <PageHeader title={t("team.list.title")} description={t("team.list.desc")} />
        <EmptyState
          icon={Users}
          title={t("team.list.noMembers")}
          description="You are not a member of any team yet."
          action={
            <Button asChild>
              <Link href={ROUTES.dashboardTeamInvite}>{t("team.list.createTeam")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const { data: team } = await supabase
    .from("teams")
    .select("*")
    .eq("id", membership.team_id)
    .single() as unknown as { data: Record<string, unknown> | null };

  const { data: members } = await supabase
    .from("team_members")
    .select("id, role, created_at, user_id")
    .eq("team_id", membership.team_id);

  const memberProfiles = await Promise.all(
    (members ?? []).map(async (member: Record<string, unknown>) => {
      const { data: prof } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", member.user_id as string)
        .single() as unknown as { data: Record<string, unknown> | null };
      return { ...member, profile: prof };
    })
  );

  return (
    <div className="space-y-8">
      <PageHeader title={t("team.list.title")} description={t("team.list.desc")}>
        <Button asChild>
          <Link href={ROUTES.dashboardTeamInvite}>
            <Plus className="mr-2 h-4 w-4" /> {t("team.list.invite")}
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("team.list.roles.owner")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{team?.name as string}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("team.list.members")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{memberProfiles.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("team.list.role")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="outline">
              {team?.plan ? String(team.plan).charAt(0).toUpperCase() + String(team.plan).slice(1) : "Free"}
            </Badge>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("team.list.members")}</CardTitle>
          <CardDescription>{t("team.list.desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {memberProfiles.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("team.list.noMembers")}</p>
            ) : (
              memberProfiles.map((member: Record<string, unknown>) => (
                <div key={member.id as string} className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0">
                  <div className="flex items-center gap-4">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback>
                        {member.profile && (member.profile as Record<string, unknown>).full_name
                          ? String((member.profile as Record<string, unknown>).full_name).charAt(0).toUpperCase()
                          : member.profile && (member.profile as Record<string, unknown>).email
                          ? String((member.profile as Record<string, unknown>).email).charAt(0).toUpperCase()
                          : "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">{member.profile ? (member.profile as Record<string, unknown>).full_name as string ?? "Unknown" : "Unknown"}</p>
                      <p className="text-xs text-muted-foreground">{member.profile ? (member.profile as Record<string, unknown>).email as string : ""}</p>
                    </div>
                    <Badge variant="outline">{member.role as string}</Badge>
                  </div>
                  {member.role !== "owner" && (member.profile as Record<string, unknown>)?.id !== user!.id && (
                    <RemoveMemberButton memberId={member.id as string} />
                  )}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
