#!/usr/bin/env node

/**
 * Supabase Auth 邮件模板与重定向白名单的单一来源。
 *
 * 背景：Supabase Auth 的验证/邀请/魔法链接/换邮箱/重置密码邮件不由应用代码发送，
 * 必须在项目 Auth 配置里维护（见 docs/design/email-templates.md）。
 * 这里把设计稿的骨架固化成可重复执行、可校验的配置补丁，避免手工粘贴产生偏差。
 */

/** 生产别名与主要域名，与 uri_allow_list 现有条目保持一致 */
const PRODUCTION_REDIRECT_ORIGIN = "https://indie-stack-theta.vercel.app";

/** 预览部署与分支别名：Vercel 预览域名形如 indiestack-git-branch-sun1090s-projects.vercel.app */
const PREVIEW_REDIRECT_PATTERNS = [
  "https://*-sun1090s-projects.vercel.app/**",
  "https://indie-stack-*.vercel.app/**",
];

/**
 * 每封 Auth 邮件只保留一个 CTA，英文为主、中文摘要，变量必须使用 Supabase 的 Go template 语法。
 * `variable` 用于生成前的最小校验，缺失即判定模板不可用，防止发出无法完成的邮件。
 */
const AUTH_EMAIL_TEMPLATES = [
  {
    key: "confirmation",
    variable: "{{ .ConfirmationURL }}",
    subject: "Confirm your email address / 确认你的邮箱地址",
    title: "Confirm your email address",
    titleZh: "确认你的邮箱地址",
    intro: "Follow the link below to confirm this email address and finish signing up.",
    introZh: "点击下方按钮确认邮箱并完成注册。",
    ctaLabel: "Confirm email",
  },
  {
    key: "invite",
    variable: "{{ .InviteURL }}",
    subject: "You've been invited to IndieStack / 邀请你加入 IndieStack",
    title: "You've been invited",
    titleZh: "你被邀请加入 IndieStack",
    intro: "Accept the invitation below to join the workspace you were invited to.",
    introZh: "点击下方按钮接受邀请并加入团队工作区。",
    ctaLabel: "Accept invite",
  },
  {
    key: "magic_link",
    variable: "{{ .ConfirmationURL }}",
    subject: "Your sign-in link / 你的登录链接",
    title: "Your sign-in link",
    titleZh: "你的登录链接",
    intro: "Use the link below to sign in. It expires shortly and can be used once.",
    introZh: "点击下方按钮登录。链接会很快失效且只能使用一次。",
    ctaLabel: "Sign in",
  },
  {
    key: "email_change",
    variable: "{{ .ConfirmationURL }}",
    subject: "Confirm your new email address / 确认新邮箱地址",
    title: "Confirm your new email address",
    titleZh: "确认你的新邮箱地址",
    intro: "Confirm the new email address so future notifications reach the right inbox.",
    introZh: "确认新邮箱地址，确保后续通知送达正确收件箱。",
    ctaLabel: "Confirm new email",
  },
  {
    key: "recovery",
    variable: "{{ .ConfirmationURL }}",
    subject: "Reset your password / 重置你的密码",
    title: "Reset your password",
    titleZh: "重置你的密码",
    intro:
      "We received a request to reset your password. The link below is valid for a short time.",
    introZh: "我们收到了重置密码的请求。下方链接仅在短时间内有效。",
    ctaLabel: "Reset password",
  },
];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 与 src/lib/email-template.ts 的 renderSkeleton 同源（600px 表格布局、同色板）。
 * Supabase 侧只能存纯 HTML，因此这里重复骨架；测试会交叉校验两者结构一致。
 */
function renderSkeleton(body) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc">
      <tr><td align="center" style="padding:32px 16px">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden">
          <tr><td style="background:linear-gradient(135deg,#0f172a,#1e1b4b);padding:24px;text-align:center">
            <span style="color:#ffffff;font-size:20px;font-weight:700">IndieStack</span>
          </td></tr>
          <tr><td style="padding:32px">${body}</td></tr>
          <tr><td style="padding:16px;background:#f1f5f9;text-align:center">
            <span style="color:#94a3b8;font-size:12px">If you didn't request this, please ignore this email. / 若非本人操作请忽略此邮件</span>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

/** 渲染单封 Auth 邮件 HTML（Go template 变量原样保留，交由 Supabase 替换） */
function renderAuthEmail(template) {
  if (!template || typeof template !== "object") {
    throw new Error("template is required");
  }
  const { variable, title, titleZh, intro, introZh, ctaLabel } = template;
  if (typeof variable !== "string" || !variable.startsWith("{{") || !variable.endsWith("}}")) {
    throw new Error("template.variable must be a Supabase Go template expression");
  }

  const body = `
            <h2 style="margin:0 0 8px;color:#0f172a">${escapeHtml(title)}</h2>
            <p style="margin:0 0 24px;color:#475569;line-height:1.6">${escapeHtml(intro)}</p>
            <p style="margin:0 0 24px;color:#64748b;line-height:1.6">${escapeHtml(titleZh)}：${escapeHtml(introZh)}</p>
            <a href="${variable}"
               style="display:inline-block;padding:12px 32px;background:#2563eb;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600">
              ${escapeHtml(ctaLabel)}
            </a>
            <p style="margin:24px 0 0;color:#94a3b8;font-size:12px;word-break:break-all">
              或复制链接：<br>${variable}
            </p>`;

  const html = renderSkeleton(body);
  assertTemplateUsable({ key: template.key, variable, html });
  return html;
}

/** 生成前的硬校验：模板必须包含自身 CTA 变量，否则邮件无法完成动作 */
function assertTemplateUsable({ key, variable, html }) {
  if (!html.includes(variable)) {
    throw new Error(`template "${key}" is missing its action variable ${variable}`);
  }
  if (!html.includes("IndieStack")) {
    throw new Error(`template "${key}" is missing the brand header`);
  }
  return true;
}

/** 生成 Supabase Management API 的 mailer_* 补丁（仅邮件相关字段，不触碰 SMTP/OAuth 配置） */
function buildAuthEmailConfigPatch() {
  const patch = {};
  for (const template of AUTH_EMAIL_TEMPLATES) {
    patch[`mailer_subjects_${template.key}`] = template.subject;
    patch[`mailer_templates_${template.key}_content`] = renderAuthEmail(template);
  }
  return patch;
}

/** 合并重定向白名单：保留既有条目，去空白/去重，只追加缺失项 */
function mergeRedirectAllowList(existing, additions = PREVIEW_REDIRECT_PATTERNS) {
  const entries = [];
  const seen = new Set();
  for (const raw of [...String(existing ?? "").split(","), ...additions]) {
    const value = String(raw ?? "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    entries.push(value);
  }
  return entries.join(",");
}

/**
 * 配置更新范围：
 * - `all`：模板 + 重定向白名单（需要自定义 SMTP 或付费套餐）
 * - `templates`：仅 mailer_* 字段
 * - `redirects`：仅 uri_allow_list（免费套餐也可应用）
 */
const CONFIG_SCOPES = ["all", "templates", "redirects"];

/** 每个 scope 覆盖的字段清单（用于 dry-run/verify 的完整性报告） */
function scopeFields(scope) {
  const resolvedScope = normalizeScope(scope);
  const templateFields = AUTH_EMAIL_TEMPLATES.flatMap((template) => [
    `mailer_subjects_${template.key}`,
    `mailer_templates_${template.key}_content`,
  ]);
  if (resolvedScope === "templates") return templateFields;
  if (resolvedScope === "redirects") return ["uri_allow_list"];
  return [...templateFields, "uri_allow_list"];
}

function normalizeScope(scope) {
  if (scope === undefined || scope === null) return "all";
  if (!CONFIG_SCOPES.includes(scope)) {
    throw new Error(`unknown scope "${scope}" (expected one of ${CONFIG_SCOPES.join(", ")})`);
  }
  return scope;
}

/** 计算一次配置更新计划（纯函数，便于测试与 dry-run） */
function planAuthConfigUpdate(current, scope) {
  const resolvedScope = normalizeScope(scope);
  const config = current ?? {};
  const patch = resolvedScope === "redirects" ? {} : buildAuthEmailConfigPatch();
  const nextAllowList = mergeRedirectAllowList(config.uri_allow_list);
  if (
    resolvedScope !== "templates" &&
    nextAllowList !== String(config.uri_allow_list ?? "").trim()
  ) {
    patch.uri_allow_list = nextAllowList;
  }

  const changes = Object.keys(patch).map((field) => ({
    field,
    changed: String(config[field] ?? "") !== patch[field],
  }));

  return {
    scope: resolvedScope,
    expectedFields: scopeFields(resolvedScope),
    patch,
    allowList: nextAllowList,
    changedFields: changes.filter((change) => change.changed).map((change) => change.field),
  };
}

/** 校验线上配置是否已应用指定范围内的全部字段（默认 all） */
function verifyAuthConfig(current, options = {}) {
  const { scope, expected } = options;
  const plan = expected ?? planAuthConfigUpdate(current, scope);
  const mismatches = [];
  for (const [field, value] of Object.entries(plan.patch)) {
    if (String(current?.[field] ?? "") !== value) mismatches.push(field);
  }
  return { ok: mismatches.length === 0, mismatches };
}

/** Supabase 免费套餐 + 默认发件人时禁止改模板；返回可操作的提示文本 */
function describeApplyFailure(message) {
  if (
    typeof message === "string" &&
    message.includes("Email template modification is not available")
  ) {
    return "当前套餐使用默认邮件服务，无法通过 API 修改模板：需在 Authentication → Emails 配置自定义 SMTP（如 Resend）或升级套餐；重定向白名单可先用 --scope=redirects 单独应用。";
  }
  return null;
}

module.exports = {
  AUTH_EMAIL_TEMPLATES,
  CONFIG_SCOPES,
  PREVIEW_REDIRECT_PATTERNS,
  PRODUCTION_REDIRECT_ORIGIN,
  assertTemplateUsable,
  buildAuthEmailConfigPatch,
  describeApplyFailure,
  escapeHtml,
  mergeRedirectAllowList,
  normalizeScope,
  planAuthConfigUpdate,
  scopeFields,
  renderAuthEmail,
  renderSkeleton,
  verifyAuthConfig,
};
