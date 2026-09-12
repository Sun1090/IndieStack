/**
 * Supabase Auth 邮件配置脚本的回归测试
 *
 * 覆盖：模板渲染的安全校验、与站内邮件骨架的一致性、白名单合并、
 * 配置计划/校验纯函数，以及 CLI 的 dry-run / apply / verify 三条路径。
 */
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderActionEmail } from "@/lib/email-template";

const require = createRequire(import.meta.url);
const templates = require("../../scripts/lib/auth-email-templates.js") as {
  AUTH_EMAIL_TEMPLATES: Array<{
    key: string;
    variable: string;
    subject: string;
    title: string;
    titleZh: string;
    intro: string;
    introZh: string;
    ctaLabel: string;
  }>;
  PREVIEW_REDIRECT_PATTERNS: string[];
  assertTemplateUsable: (input: { key: string; variable: string; html: string }) => boolean;
  buildAuthEmailConfigPatch: () => Record<string, string>;
  describeApplyFailure: (message: unknown) => string | null;
  mergeRedirectAllowList: (existing: string | undefined, additions?: string[]) => string;
  normalizeScope: (scope?: string | null) => string;
  scopeFields: (scope?: string) => string[];
  planAuthConfigUpdate: (
    current: Record<string, unknown>,
    scope?: string,
  ) => {
    scope: string;
    expectedFields: string[];
    patch: Record<string, string>;
    allowList: string;
    changedFields: string[];
  };
  renderAuthEmail: (template: unknown) => string;
  renderSkeleton: (body: string) => string;
  verifyAuthConfig: (
    current: Record<string, unknown>,
    options?: { scope?: string; expected?: { patch: Record<string, string> } },
  ) => { ok: boolean; mismatches: string[] };
};
const cli = require("../../scripts/apply-auth-email-templates.js") as {
  applyAuthConfig: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  describeApiError: (prefix: string, response: Response, body: unknown) => string;
  main: (argv?: string[], env?: Record<string, string | undefined>) => Promise<number>;
  parseArgs: (argv: string[]) => { mode: string; scope?: string };
  readConfig: (env: Record<string, string | undefined>) => {
    ok: boolean;
    missing: string[];
  };
};

const BASE_CONFIG = {
  site_url: "https://indie-stack-theta.vercel.app",
  uri_allow_list: "http://localhost:3000/**,https://indie-stack-theta.vercel.app/**",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Auth 邮件模板", () => {
  it("每封邮件都保留自己的 CTA 变量并且不含未转义的双花括号占位符", () => {
    for (const template of templates.AUTH_EMAIL_TEMPLATES) {
      const html = templates.renderAuthEmail(template);
      expect(html).toContain(template.variable);
      expect(html).toContain("IndieStack");
      expect(html.startsWith("<!doctype html>")).toBe(true);
      // 除声明的 Go template 变量外，不应残留其它占位符（避免手工粘贴残留）
      const stray = html.replaceAll(template.variable, "").match(/\{\{[^}]*\}\}/g) ?? [];
      expect(stray).toEqual([]);
    }
  });

  it("缺少 CTA 变量或品牌头时拒绝生成，避免发出无法完成的邮件", () => {
    expect(() =>
      templates.assertTemplateUsable({ key: "x", variable: "{{ .X }}", html: "<p></p>" }),
    ).toThrow(/missing its action variable/);
    expect(() =>
      templates.assertTemplateUsable({ key: "x", variable: "{{ .X }}", html: "{{ .X }}" }),
    ).toThrow(/missing the brand header/);
    expect(() => templates.renderAuthEmail(null)).toThrow(/template is required/);
    expect(() => templates.renderAuthEmail({ key: "x", variable: "not-a-template" })).toThrow(
      /Go template expression/,
    );
  });

  it("与站内邮件骨架保持同一套视觉结构（同源 docs/design/email-templates.md）", () => {
    const appSkeleton = renderActionEmail({
      siteUrl: "https://indie-stack-theta.vercel.app",
      subject: "Confirm your email address",
      bodyText: "Follow the link below.",
      ctaUrl: "https://example.com/confirm",
      ctaLabel: "Confirm email",
    });
    const authHtml = templates.renderAuthEmail(templates.AUTH_EMAIL_TEMPLATES[0]);
    const authSkeleton = templates.renderSkeleton("<p>body</p>");

    // 骨架层（不含正文 CTA）必须逐项一致
    for (const marker of [
      "linear-gradient(135deg,#0f172a,#1e1b4b)",
      "border-radius:12px",
      'width="600"',
      ">IndieStack</span>",
    ]) {
      expect(appSkeleton).toContain(marker);
      expect(authSkeleton).toContain(marker);
    }
    // 两个渲染器的 CTA 按钮样式一致
    expect(appSkeleton).toContain("background:#2563eb");
    expect(authHtml).toContain("background:#2563eb");
    expect(appSkeleton).toContain("If you didn't request this, please ignore this email.");
    expect(authSkeleton).toContain("若非本人操作请忽略此邮件");
  });

  it("生成 5 个模板的 subject/content 补丁", () => {
    const patch = templates.buildAuthEmailConfigPatch();
    expect(Object.keys(patch)).toHaveLength(templates.AUTH_EMAIL_TEMPLATES.length * 2);
    for (const template of templates.AUTH_EMAIL_TEMPLATES) {
      expect(patch[`mailer_subjects_${template.key}`]).toBe(template.subject);
      expect(patch[`mailer_templates_${template.key}_content`]).toContain(template.variable);
      expect(patch[`mailer_subjects_${template.key}`].length).toBeLessThanOrEqual(255);
    }
  });
});

describe("重定向白名单合并", () => {
  it("保留既有条目、去重并追加预览域名", () => {
    const merged = templates.mergeRedirectAllowList(
      " http://localhost:3000/** , https://indie-stack-theta.vercel.app/** ,http://localhost:3000/**,",
    );
    const entries = merged.split(",");
    expect(entries[0]).toBe("http://localhost:3000/**");
    expect(entries[1]).toBe("https://indie-stack-theta.vercel.app/**");
    expect(entries).toEqual(expect.arrayContaining(templates.PREVIEW_REDIRECT_PATTERNS));
    expect(new Set(entries).size).toBe(entries.length);
  });

  it("对空配置安全返回最小集合", () => {
    expect(templates.mergeRedirectAllowList("")).toBe(
      templates.PREVIEW_REDIRECT_PATTERNS.join(","),
    );
    expect(templates.mergeRedirectAllowList(undefined, [])).toBe("");
  });
});

describe("配置计划与校验", () => {
  it("dry-run 计划包含全部模板字段与缺失的白名单条目", () => {
    const plan = templates.planAuthConfigUpdate(BASE_CONFIG);
    expect(plan.changedFields).toContain("uri_allow_list");
    expect(plan.changedFields).toContain("mailer_templates_recovery_content");
    expect(plan.changedFields).toHaveLength(templates.AUTH_EMAIL_TEMPLATES.length * 2 + 1);
    expect(plan.allowList).toContain("https://*-sun1090s-projects.vercel.app/**");
  });

  it("幂等：把计划应用回配置后不再产生变更", () => {
    const plan = templates.planAuthConfigUpdate(BASE_CONFIG);
    const applied = { ...BASE_CONFIG, ...plan.patch };
    const second = templates.planAuthConfigUpdate(applied);
    expect(second.changedFields).toEqual([]);
    expect(templates.verifyAuthConfig(applied)).toEqual({ ok: true, mismatches: [] });
  });

  it("verify 报告与设计稿不一致的字段", () => {
    const stale = { ...BASE_CONFIG, mailer_subjects_recovery: "Old subject" };
    const result = templates.verifyAuthConfig(stale);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toContain("mailer_subjects_recovery");
  });
});

describe("CLI", () => {
  it("解析模式与 scope：默认 dry-run/all，支持 --apply / --verify / --scope", () => {
    expect(cli.parseArgs([])).toMatchObject({ mode: "--dry-run", scope: undefined });
    expect(cli.parseArgs(["--", "--apply"]).mode).toBe("--apply");
    expect(cli.parseArgs(["--verify", "--scope=redirects"])).toMatchObject({
      mode: "--verify",
      scope: "redirects",
    });
    expect(() => cli.parseArgs(["surprise"])).toThrow(/unexpected argument/);
    expect(() => cli.parseArgs(["--bogus"])).toThrow(/unknown flag/);
    expect(() => cli.parseArgs(["--scope=nope"])).toThrow(/unknown scope/);
  });

  it("scope=redirects 只更新白名单；scope=templates 不触碰白名单", () => {
    expect(templates.normalizeScope(undefined)).toBe("all");
    expect(templates.normalizeScope("redirects")).toBe("redirects");
    expect(() => templates.normalizeScope("nope")).toThrow(/unknown scope/);

    const redirectPlan = templates.planAuthConfigUpdate(BASE_CONFIG, "redirects");
    expect(redirectPlan.scope).toBe("redirects");
    expect(redirectPlan.changedFields).toEqual(["uri_allow_list"]);
    expect(redirectPlan.expectedFields).toEqual(["uri_allow_list"]);
    expect(templates.scopeFields("templates")).toHaveLength(
      templates.AUTH_EMAIL_TEMPLATES.length * 2,
    );
    expect(templates.scopeFields("all")).toHaveLength(
      templates.AUTH_EMAIL_TEMPLATES.length * 2 + 1,
    );

    const templatePlan = templates.planAuthConfigUpdate(BASE_CONFIG, "templates");
    expect(templatePlan.scope).toBe("templates");
    expect(templatePlan.patch.uri_allow_list).toBeUndefined();
    expect(templatePlan.expectedFields).not.toContain("uri_allow_list");
    expect(templatePlan.changedFields).toHaveLength(templates.AUTH_EMAIL_TEMPLATES.length * 2);

    // 只应用 redirects 时，redirects 范围校验通过，templates 范围仍然未完成
    const redirectsApplied = { ...BASE_CONFIG, uri_allow_list: redirectPlan.allowList };
    expect(
      templates.verifyAuthConfig(redirectsApplied, {
        expected: templates.planAuthConfigUpdate(redirectsApplied, "redirects"),
      }),
    ).toEqual({ ok: true, mismatches: [] });
    expect(templates.verifyAuthConfig(redirectsApplied, { scope: "templates" }).ok).toBe(false);
  });

  it("免费套餐默认发件人错误会给出可操作提示", () => {
    const hint = templates.describeApplyFailure(
      "failed to update auth config: HTTP 400 - Email template modification is not available for free tier projects using the default email provider.",
    );
    expect(hint).toContain("自定义 SMTP");
    expect(templates.describeApplyFailure("failed to update auth config: HTTP 500")).toBeNull();
    expect(templates.describeApplyFailure(undefined)).toBeNull();
  });

  it("--scope=redirects --apply 只发送白名单字段", async () => {
    const plan = templates.planAuthConfigUpdate(BASE_CONFIG, "redirects");
    const applied = { ...BASE_CONFIG, ...plan.patch };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(BASE_CONFIG))
      .mockResolvedValueOnce(json(applied));
    vi.stubGlobal("fetch", fetchImpl);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      cli.main(["--apply", "--scope=redirects"], {
        SUPABASE_ACCESS_TOKEN: "t",
        SUPABASE_PROJECT_REF: "ref",
      }),
    ).resolves.toBe(0);

    const [, init] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(Object.keys(JSON.parse(String(init.body)))).toEqual(["uri_allow_list"]);
  });

  it("模板写入被套餐拒绝时打印提示并返回 1", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(BASE_CONFIG))
      .mockResolvedValueOnce(
        json(
          {
            message:
              "Email template modification is not available for free tier projects using the default email provider.",
          },
          400,
        ),
      );
    vi.stubGlobal("fetch", fetchImpl);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      cli.main(["--apply", "--scope=templates"], {
        SUPABASE_ACCESS_TOKEN: "t",
        SUPABASE_PROJECT_REF: "ref",
      }),
    ).resolves.toBe(1);

    expect(error).toHaveBeenCalledWith(expect.stringContaining("自定义 SMTP"));
  });

  it("缺少凭据时报告缺失变量并以 2 退出", async () => {
    expect(cli.readConfig({})).toMatchObject({ ok: false });
    expect(cli.readConfig({}).missing).toEqual(["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF"]);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(cli.main([], {})).resolves.toBe(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("SUPABASE_ACCESS_TOKEN"));
  });

  it("dry-run 只读取配置、不发送 PATCH", async () => {
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) => json(BASE_CONFIG));
    vi.stubGlobal("fetch", fetchImpl);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      cli.main(["--dry-run"], { SUPABASE_ACCESS_TOKEN: "t", SUPABASE_PROJECT_REF: "ref" }),
    ).resolves.toBe(0);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("dry-run"));
  });

  it("--apply 发送 PATCH 并用返回配置复核", async () => {
    const plan = templates.planAuthConfigUpdate(BASE_CONFIG);
    const applied = { ...BASE_CONFIG, ...plan.patch };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(BASE_CONFIG))
      .mockResolvedValueOnce(json(applied));
    vi.stubGlobal("fetch", fetchImpl);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      cli.main(["--apply"], { SUPABASE_ACCESS_TOKEN: "t", SUPABASE_PROJECT_REF: "ref" }),
    ).resolves.toBe(0);

    // 1 次读取 + 1 次 PATCH（PATCH 响应即为复核输入）
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(url).toContain("/projects/ref/config/auth");
    expect(init.method).toBe("PATCH");
    const payload = JSON.parse(String(init.body)) as Record<string, string>;
    expect(payload.mailer_subjects_confirmation).toContain("Confirm your email address");
    expect(payload.uri_allow_list).toContain("https://*-sun1090s-projects.vercel.app/**");
  });

  it("写入后复核失败时返回 1", async () => {
    const plan = templates.planAuthConfigUpdate(BASE_CONFIG);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(BASE_CONFIG))
      .mockResolvedValueOnce(
        json({ ...BASE_CONFIG, ...plan.patch, mailer_subjects_invite: "stale" }),
      );
    vi.stubGlobal("fetch", fetchImpl);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      cli.main(["--apply"], { SUPABASE_ACCESS_TOKEN: "t", SUPABASE_PROJECT_REF: "ref" }),
    ).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("mailer_subjects_invite"));
  });

  it("已是最新配置时不做写入", async () => {
    const applied = { ...BASE_CONFIG, ...templates.buildAuthEmailConfigPatch() };
    applied.uri_allow_list = templates.mergeRedirectAllowList(BASE_CONFIG.uri_allow_list);
    const fetchImpl = vi.fn(async () => json(applied));
    vi.stubGlobal("fetch", fetchImpl);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      cli.main([], { SUPABASE_ACCESS_TOKEN: "t", SUPABASE_PROJECT_REF: "ref" }),
    ).resolves.toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("已是最新"));
  });

  it("读取失败或 HTTP 错误时返回 1 并带上 API 摘要", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ message: "forbidden" }, 403)),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      cli.main(["--verify"], { SUPABASE_ACCESS_TOKEN: "t", SUPABASE_PROJECT_REF: "ref" }),
    ).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("HTTP 403 - forbidden"));
  });

  it("API 错误摘要只保留 message 且截断超长内容", () => {
    const short = cli.describeApiError(
      "failed to update auth config",
      new Response(null, { status: 400 }),
      {
        message: "invalid template",
      },
    );
    expect(short).toBe("failed to update auth config: HTTP 400 - invalid template");

    const noDetail = cli.describeApiError(
      "failed to read auth config",
      new Response(null, { status: 500 }),
      null,
    );
    expect(noDetail).toBe("failed to read auth config: HTTP 500");

    const long = cli.describeApiError(
      "failed to update auth config",
      new Response(null, { status: 422 }),
      {
        message: "x".repeat(500),
      },
    );
    expect(long).toContain("x".repeat(200));
    expect(long).not.toContain("x".repeat(201));
  });
});
