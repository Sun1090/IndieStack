import { describe, expect, it } from "vitest";
import { PROVIDER_REGISTRY } from "./diagnostics";
import { auditProviderDocs, formatProviderDocIssues } from "./provider-docs";

function completeDoc(): string {
  return PROVIDER_REGISTRY.map((provider) => `${provider.id}: ${provider.keys.join(" ")}`).join(
    "\n",
  );
}

describe("provider documentation audit", () => {
  it("passes when both locale guides document every provider and key", () => {
    const report = auditProviderDocs([
      { path: "docs-site/provider-diagnostics.md", content: completeDoc() },
      { path: "docs-site/zh-CN/provider-diagnostics.md", content: completeDoc() },
    ]);
    expect(report.issues).toEqual([]);
    expect(report.providers).toBe(PROVIDER_REGISTRY.length);
    const keyCount = PROVIDER_REGISTRY.reduce((total, provider) => total + provider.keys.length, 0);
    expect(report.keys).toBe(keyCount * 2);
  });

  it("fails closed for an empty document", () => {
    const report = auditProviderDocs([{ path: "empty.md", content: "   \n" }]);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({
      code: "PROVIDER_DOC_SOURCE_EMPTY",
      path: "empty.md",
    });
  });

  it("reports a provider id that is missing from one locale", () => {
    const report = auditProviderDocs([
      { path: "docs-site/provider-diagnostics.md", content: completeDoc() },
      {
        path: "docs-site/zh-CN/provider-diagnostics.md",
        content: completeDoc().replace(/stripe/g, "payments"),
      },
    ]);
    const issues = report.issues.filter((issue) => issue.code === "PROVIDER_DOC_MISSING_PROVIDER");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      provider: "stripe",
      path: "docs-site/zh-CN/provider-diagnostics.md",
    });
  });

  it("reports every missing environment key with its provider", () => {
    const report = auditProviderDocs([
      {
        path: "docs-site/provider-diagnostics.md",
        content: completeDoc().replace("CRON_SECRET", "").replace("OSS_REGION", ""),
      },
    ]);
    const keyIssues = report.issues.filter((issue) => issue.code === "PROVIDER_DOC_MISSING_KEY");
    expect(keyIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: "cron", key: "CRON_SECRET" }),
        expect.objectContaining({ provider: "storage", key: "OSS_REGION" }),
      ]),
    );
  });

  it("does not confuse a provider id with its hyphenated sibling", () => {
    const report = auditProviderDocs([{ path: "only-sibling.md", content: "supabase-restore" }]);
    const missingProviders = report.issues
      .filter((issue) => issue.code === "PROVIDER_DOC_MISSING_PROVIDER")
      .map((issue) => issue.provider);
    expect(missingProviders).toContain("supabase");
  });

  it("formats issues without dropping codes or paths", () => {
    const report = auditProviderDocs([{ path: "missing.md", content: "supabase" }]);
    const formatted = formatProviderDocIssues(report.issues);
    expect(formatted).toContain("[PROVIDER_DOC_MISSING_PROVIDER]");
    expect(formatted).toContain("missing.md");
  });
});
