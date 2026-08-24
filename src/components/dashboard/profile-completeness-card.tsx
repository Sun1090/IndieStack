/**
 * 资料完整度卡片（服务端渲染）
 * 字段：姓名 / 简介 / 时区 / 语言 各 25%
 */
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export async function ProfileCompletenessCard({
  profile,
}: {
  profile: Record<string, unknown>;
}) {
  const t = await getTranslations("dashboard");

  const fields = [
    { label: t("profile.view.name"), filled: Boolean(profile.full_name) },
    { label: t("profile.edit.bio"), filled: Boolean(profile.bio) },
    { label: t("profile.view.timezone"), filled: Boolean(profile.timezone) },
    { label: t("profile.view.language"), filled: Boolean(profile.language) },
  ];
  const filled = fields.filter((f) => f.filled).length;
  const percent = Math.round((filled / fields.length) * 100);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          {t("profile.completeness")} — {percent}%
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {fields.map((f) => (
            <li key={f.label}>{f.filled ? `✓ ${f.label}` : `○ ${f.label}`}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
