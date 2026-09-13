import { describe, expect, it } from "vitest";
import {
  diagnoseProviders,
  formatProviderReport,
  missingKeys,
  PROVIDER_REGISTRY,
  type EnvRecord,
  type ProviderDiagnostic,
} from "./diagnostics";

const BASE_SUPABASE: EnvRecord = {
  NEXT_PUBLIC_SUPABASE_URL: "https://demo.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  SUPABASE_DB_URL: "postgresql://postgres:password@db.demo.supabase.co:5432/postgres",
};

function provider(report: ReturnType<typeof diagnoseProviders>, id: string): ProviderDiagnostic {
  const match = report.providers.find((candidate) => candidate.id === id);
  if (!match) throw new Error(`missing provider ${id}`);
  return match;
}

describe("provider diagnostics", () => {
  it("treats an empty non-production environment as mock mode", () => {
    const report = diagnoseProviders({ NODE_ENV: "development" });
    expect(report.mockMode).toBe(true);
    expect(report.ok).toBe(true);
    expect(provider(report, "supabase")).toMatchObject({
      status: "disabled",
      required: true,
      configured: false,
    });
    expect(provider(report, "storage")).toMatchObject({
      status: "ready",
      provider: "mock",
      configured: true,
    });
  });

  it("fails closed when production Supabase configuration is missing", () => {
    const report = diagnoseProviders({ NODE_ENV: "production" });
    expect(report.mockMode).toBe(false);
    expect(report.ok).toBe(false);
    expect(provider(report, "supabase")).toMatchObject({
      status: "missing",
      required: true,
      configured: false,
      missing: [
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_DB_URL",
      ],
    });
    expect(report.problems.some((problem) => problem.startsWith("supabase: missing"))).toBe(true);
  });

  it("reports a ready Supabase runtime and database configuration", () => {
    const report = diagnoseProviders({ NODE_ENV: "production", ...BASE_SUPABASE });
    expect(report.ok).toBe(true);
    expect(provider(report, "supabase").status).toBe("ready");
    expect(provider(report, "storage")).toMatchObject({
      status: "ready",
      provider: "supabase",
      configured: true,
    });
  });

  it("degrades when runtime Supabase is present but migrations lack a direct URL", () => {
    const { SUPABASE_DB_URL: _ignored, ...runtime } = BASE_SUPABASE;
    const report = diagnoseProviders({ NODE_ENV: "production", ...runtime });
    expect(report.ok).toBe(true);
    expect(provider(report, "supabase")).toMatchObject({
      status: "degraded",
      configured: true,
      missing: ["SUPABASE_DB_URL"],
    });
    expect(report.warnings).toContain("supabase: degraded (SUPABASE_DB_URL)");
  });

  it("selects OSS only when all four storage keys are present", () => {
    const complete = diagnoseProviders({
      NODE_ENV: "production",
      ...BASE_SUPABASE,
      OSS_BUCKET: "bucket",
      OSS_REGION: "oss-cn-hangzhou",
      OSS_ACCESS_KEY_ID: "id",
      OSS_ACCESS_KEY_SECRET: "secret",
    });
    expect(provider(complete, "storage")).toMatchObject({
      status: "ready",
      provider: "oss",
      configured: true,
      missing: [],
    });
  });

  it("fails closed on partial OSS configuration and reports the fallback", () => {
    const report = diagnoseProviders({
      NODE_ENV: "production",
      ...BASE_SUPABASE,
      OSS_BUCKET: "bucket",
      OSS_REGION: "oss-cn-hangzhou",
    });
    expect(report.ok).toBe(false);
    expect(provider(report, "storage")).toMatchObject({
      status: "misconfigured",
      provider: "supabase",
      missing: ["OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_SECRET"],
    });
  });

  it("distinguishes disabled, partial, and configured Web Push", () => {
    expect(
      provider(diagnoseProviders({ NODE_ENV: "production", ...BASE_SUPABASE }), "webpush").status,
    ).toBe("disabled");
    const partial = diagnoseProviders({
      NODE_ENV: "production",
      ...BASE_SUPABASE,
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: "public",
    });
    expect(provider(partial, "webpush")).toMatchObject({
      status: "misconfigured",
      missing: ["VAPID_PRIVATE_KEY"],
    });
    expect(partial.ok).toBe(false);
    const ready = diagnoseProviders({
      NODE_ENV: "production",
      ...BASE_SUPABASE,
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: "public",
      VAPID_PRIVATE_KEY: "private",
    });
    expect(provider(ready, "webpush").status).toBe("ready");
  });

  it("treats an email override without an API key as misconfiguration", () => {
    const report = diagnoseProviders({
      NODE_ENV: "production",
      ...BASE_SUPABASE,
      RESEND_FROM: "Team <team@example.com>",
    });
    expect(provider(report, "email")).toMatchObject({
      status: "misconfigured",
      missing: ["RESEND_API_KEY"],
    });
    expect(report.ok).toBe(false);
  });

  it("handles Appark as an optional paired provider", () => {
    const partial = diagnoseProviders({
      NODE_ENV: "production",
      ...BASE_SUPABASE,
      NEXT_PUBLIC_APPARK_API_KEY: "key",
    });
    expect(provider(partial, "appark")).toMatchObject({
      status: "misconfigured",
      missing: ["NEXT_PUBLIC_APPARK_ENDPOINT"],
    });
    const ready = diagnoseProviders({
      NODE_ENV: "production",
      ...BASE_SUPABASE,
      NEXT_PUBLIC_APPARK_API_KEY: "key",
      NEXT_PUBLIC_APPARK_ENDPOINT: "https://collector.example.com/events",
    });
    expect(provider(ready, "appark").status).toBe("ready");
  });

  it("requires all Stripe keys before calling billing ready", () => {
    const partial = diagnoseProviders({
      NODE_ENV: "production",
      ...BASE_SUPABASE,
      STRIPE_SECRET_KEY: "sk_test",
    });
    expect(provider(partial, "stripe")).toMatchObject({
      status: "misconfigured",
      missing: [
        "STRIPE_WEBHOOK_SECRET",
        "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
        "STRIPE_PRO_PRICE_ID",
        "STRIPE_ENTERPRISE_PRICE_ID",
      ],
    });
    const ready = diagnoseProviders({
      NODE_ENV: "production",
      ...BASE_SUPABASE,
      STRIPE_SECRET_KEY: "sk_test",
      STRIPE_WEBHOOK_SECRET: "whsec_test",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test",
      STRIPE_PRO_PRICE_ID: "price_pro",
      STRIPE_ENTERPRISE_PRICE_ID: "price_enterprise",
    });
    expect(provider(ready, "stripe").status).toBe("ready");
  });

  it("degrades Sentry runtime capture when build-time sourcemap keys are missing", () => {
    const report = diagnoseProviders({
      NODE_ENV: "production",
      ...BASE_SUPABASE,
      NEXT_PUBLIC_SENTRY_DSN: "https://public@example.ingest.sentry.io/1",
    });
    expect(provider(report, "sentry")).toMatchObject({
      status: "degraded",
      configured: true,
      missing: ["SENTRY_ORG", "SENTRY_PROJECT", "SENTRY_AUTH_TOKEN"],
    });
    expect(report.warnings.some((warning) => warning.startsWith("sentry: degraded"))).toBe(true);
  });

  it("reports Sentry as misconfigured when sourcemap credentials exist without a DSN", () => {
    const report = diagnoseProviders({
      NODE_ENV: "production",
      ...BASE_SUPABASE,
      SENTRY_ORG: "org",
      SENTRY_PROJECT: "project",
      SENTRY_AUTH_TOKEN: "token",
    });
    expect(provider(report, "sentry")).toMatchObject({
      status: "misconfigured",
      missing: ["NEXT_PUBLIC_SENTRY_DSN"],
    });
  });

  it("supports both explicit and inferred Supabase project references", () => {
    const explicit = diagnoseProviders({
      NODE_ENV: "production",
      ...BASE_SUPABASE,
      SUPABASE_ACCESS_TOKEN: "sbp_token",
      SUPABASE_PROJECT_REF: "project-ref",
    });
    expect(provider(explicit, "supabase-restore").status).toBe("ready");

    const inferred = diagnoseProviders({
      NODE_ENV: "production",
      ...BASE_SUPABASE,
      SUPABASE_ACCESS_TOKEN: "sbp_token",
    });
    expect(provider(inferred, "supabase-restore").status).toBe("ready");
  });

  it("fails closed on partial Supabase restore configuration", () => {
    const withoutToken = diagnoseProviders({
      NODE_ENV: "production",
      ...BASE_SUPABASE,
      SUPABASE_PROJECT_REF: "project-ref",
    });
    expect(provider(withoutToken, "supabase-restore")).toMatchObject({
      status: "misconfigured",
      missing: ["SUPABASE_ACCESS_TOKEN"],
    });

    const withoutRef = diagnoseProviders({
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://custom.example.com",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      SUPABASE_DB_URL: "postgresql://example",
      SUPABASE_ACCESS_TOKEN: "sbp_token",
    });
    expect(provider(withoutRef, "supabase-restore")).toMatchObject({
      status: "misconfigured",
      missing: ["SUPABASE_PROJECT_REF"],
    });
  });

  it("reports cron authentication as ready or disabled", () => {
    const disabled = diagnoseProviders({ NODE_ENV: "production", ...BASE_SUPABASE });
    expect(provider(disabled, "cron").status).toBe("disabled");
    const ready = diagnoseProviders({
      NODE_ENV: "production",
      ...BASE_SUPABASE,
      CRON_SECRET: "secret",
    });
    expect(provider(ready, "cron")).toMatchObject({ status: "ready", configured: true });
  });

  it("never includes credential values in the formatted report", () => {
    const report = diagnoseProviders({
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://secret-ref.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "super-secret-anon",
      SUPABASE_SERVICE_ROLE_KEY: "super-secret-service",
      SUPABASE_DB_URL: "postgresql://user:super-secret-password@db.example.com/postgres",
    });
    const output = formatProviderReport(report);
    expect(output).not.toContain("super-secret");
    expect(output).not.toContain("postgresql://");
    expect(output).toContain("Provider diagnostics");
    expect(output).toContain("supabase");
  });

  it("includes every registry key exactly once and keeps provider ids unique", () => {
    const ids = PROVIDER_REGISTRY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = PROVIDER_REGISTRY.flatMap((entry) => entry.keys);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(keys).toContain("CRON_SECRET");
  });

  it("returns only the missing variable names", () => {
    expect(missingKeys({ A: "value", B: undefined }, ["A", "B", "C"])).toEqual(["B", "C"]);
  });
});
