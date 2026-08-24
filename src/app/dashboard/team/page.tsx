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
import { InitialAvatar } from "@/components/shared/initial-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Users, Plus } from "lucide-react";
import { RemoveMemberButton } from "@/components/dashboard/remove-member-button";
import { MemberRoleSelect } from "@/components/dashboard/member-role-select";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("team.list.metaTitle"), description: t("team.list.metaDesc") };
}


/** 单成员行展示（父组件预计算所有值） */
function TeamMemberRow({
  avatarName,
  displayName,
  email,
  roleLabel,
  canModify,
  memberId,
  memberRole,
}: {
  avatarName: string;
  displayName: string;
  email: string;
  roleLabel: string;
  canModify: boolean;
  memberId: string;
  memberRole: string;
}) {
  return (
    <div className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0">
      <div className="flex items-center gap-4">
        <InitialAvatar name={avatarName} className="h-10 w-10 text-sm" />
        <div>
          <p className="text-sm font-medium">{displayName}</p>
          <p className="text-xs text-muted-foreground">{email}</p>
        </div>
        <Badge variant="outline">{roleLabel}</Badge>
      </div>
      {canModify && (
        <div className="flex items-center gap-2">
          <MemberRoleSelect
            memberId={memberId}
            currentRole={memberRole as "admin" | "member"}
          />
          <RemoveMemberButton memberId={memberId} />
        </div>
      )}
    </div>
  );
}

export default async function TeamPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const t = await getTranslations("dashboard");
  const tc = await getTranslations("common");

  const { data: membership } = (await supabase
    .from("team_members")
    .select("team_id, role")
    .eq("user_id", user!.id)
    .limit(1)
    .single()) as unknown as { data: { team_id: string; role: string } | null };

  if (!membership) {
    return (
      <div className="space-y-8">
        <PageHeader title={t("team.list.title")} description={t("team.list.desc")} />
        <EmptyState
          icon={Users}
          title={t("team.list.noMembers")}
          description={t("team.list.noTeamDesc")}
          action={
            <Button asChild>
              <Link href={ROUTES.dashboardTeamInvite}>{t("team.list.createTeam")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const { data: team } = (await supabase
    .from("teams")
    .select("*")
    .eq("id", membership.team_id)
    .single()) as unknown as { data: Record<string, unknown> | null };

  const { data: members } = await supabase
    .from("team_members")
    .select(
      `
      id,
      role,
      created_at,
      user_id,
      profiles:user_id (
        id,
        email,
        full_name,
        avatar_url
      )
    `,
    )
    .eq("team_id", membership.team_id);

  const memberProfiles = (members ?? []) as Array<
    Record<string, unknown> & {
      role: string;
      profiles: {
        id: string;
        email: string | null;
        full_name: string | null;
        avatar_url: string | null;
      } | null;
    }
  >;

  // 仅 owner/admin 可管理团队成员（邀请/移除），member/viewer 只读
  const canManage = membership.role === "owner" || membership.role === "admin";
  const ownerCount = memberProfiles.filter((m) => m.role === "owner").length;

  return (
    <div className="space-y-8">
      <PageHeader title={t("team.list.title")} description={t("team.list.desc")}>
        {canManage && (
          <Button asChild>
            <Link href={ROUTES.dashboardTeamInvite}>
              <Plus className="mr-2 h-4 w-4" /> {t("team.list.invite")}
            </Link>
          </Button>
        )}
      </PageHeader>

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("team.list.roles.owner")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{ownerCount}</p>
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
              {tc(
                team?.plan === "pro" || team?.plan === "enterprise"
                  ? (team.plan as "pro" | "enterprise")
                  : "free",
              )}
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
              memberProfiles.map((raw) => {
                const p = (raw.profiles ?? {}) as Record<string, string | null>;
                const role = String(raw.role);
                const roleLabel = t.has(`team.list.roles.${role}`)
                  ? t(`team.list.roles.${role}`)
                  : role;
                const canModify =
                  canManage && role !== "owner" && p.id !== user!.id;
                const displayName =
                  (p.full_name as string | undefined) ?? t("team.list.unknownMember");
                return (
                  <TeamMemberRow
                    key={String(raw.id)}
                    avatarName={String(p.full_name ?? p.email ?? "?")}
                    displayName={displayName}
                    email={p.email ?? ""}
                    roleLabel={roleLabel}
                    canModify={canModify}
                    memberId={String(raw.id)}
                    memberRole={role}
                  />
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
