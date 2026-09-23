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
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
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
          <p className="text-muted-foreground text-xs">{email}</p>
        </div>
        <Badge variant="outline">{roleLabel}</Badge>
      </div>
      {canModify && (
        <div className="flex items-center gap-2">
          <MemberRoleSelect memberId={memberId} currentRole={memberRole as "admin" | "member"} />
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

  const { data: membership, error: membershipError } = await supabase
    .from("team_members")
    .select("team_id, role")
    .eq("user_id", user!.id)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    // 读不到就不能假装读到了：继续渲染会给出「你还没有团队」这个空态加一个「创建团队」按钮，
    // 用户于是相信自己没有团队（而真实原因是一次失败的读取），最坏情况是再建一个团队。
    throw new Error(`读取团队成员失败：${membershipError.message}`);
  }

  if (!membership) {
    return (
      <div className="space-y-8">
        <Breadcrumbs
          items={[{ label: tc("dashboard"), href: "/dashboard" }, { label: t("team.list.title") }]}
        />
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

  const { data: team, error: teamError } = await supabase
    .from("teams")
    .select("*")
    .eq("id", membership.team_id)
    .maybeSingle();

  if (teamError) {
    throw new Error(`读取团队信息失败：${teamError.message}`);
  }

  const { data: members, error: membersError } = await supabase
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

  // 这一处连类型断言都没有（C08 门禁看不见它），但失败方向更要紧：`members` 为 null 会被
  // 当成「这个团队一个人也没有」渲染——人数卡片显示 0、列表显示空态，而团队里可能全是人。
  if (membersError) {
    throw new Error(`读取团队成员列表失败：${membersError.message}`);
  }

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
              <Plus className="me-2 h-4 w-4" /> {t("team.list.invite")}
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
              <EmptyState icon={Users} title={t("team.list.noMembers")} className="py-6" />
            ) : (
              memberProfiles.map((raw) => {
                const p = (raw.profiles ?? {}) as Record<string, string | null>;
                const role = String(raw.role);
                const roleLabel = t.has(`team.list.roles.${role}`)
                  ? t(`team.list.roles.${role}`)
                  : role;
                const canModify = canManage && role !== "owner" && p.id !== user!.id;
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
