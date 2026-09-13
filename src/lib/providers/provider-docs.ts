/**
 * Provider documentation contract (I08).
 *
 * The diagnostics guide is only useful if it stays in lockstep with the runtime
 * provider registry. This module fails closed when a provider id or environment
 * key is added to code without being documented.
 */
import { PROVIDER_REGISTRY } from "./diagnostics.ts";

export interface ProviderDocInput {
  path: string;
  content: string;
}

export type ProviderDocIssueCode =
  "PROVIDER_DOC_SOURCE_EMPTY" | "PROVIDER_DOC_MISSING_PROVIDER" | "PROVIDER_DOC_MISSING_KEY";

export interface ProviderDocIssue {
  code: ProviderDocIssueCode;
  path: string;
  provider?: string;
  key?: string;
  message: string;
}

export interface ProviderDocReport {
  providers: number;
  keys: number;
  issues: ProviderDocIssue[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsProviderId(content: string, id: string): boolean {
  return new RegExp(`(^|[^a-z0-9_-])${escapeRegExp(id)}([^a-z0-9_-]|$)`, "i").test(content);
}

/** Audit every supplied document against the provider registry. */
export function auditProviderDocs(documents: readonly ProviderDocInput[]): ProviderDocReport {
  const issues: ProviderDocIssue[] = [];
  let keyCount = 0;

  for (const document of documents) {
    if (document.content.trim().length === 0) {
      issues.push({
        code: "PROVIDER_DOC_SOURCE_EMPTY",
        path: document.path,
        message: `${document.path} is empty`,
      });
      continue;
    }
    for (const provider of PROVIDER_REGISTRY) {
      keyCount += provider.keys.length;
      if (!containsProviderId(document.content, provider.id)) {
        issues.push({
          code: "PROVIDER_DOC_MISSING_PROVIDER",
          path: document.path,
          provider: provider.id,
          message: `${document.path} does not document provider "${provider.id}"`,
        });
      }
      for (const key of provider.keys) {
        if (!document.content.includes(key)) {
          issues.push({
            code: "PROVIDER_DOC_MISSING_KEY",
            path: document.path,
            provider: provider.id,
            key,
            message: `${document.path} does not document "${key}" for provider "${provider.id}"`,
          });
        }
      }
    }
  }

  return {
    providers: PROVIDER_REGISTRY.length,
    keys: keyCount,
    issues,
  };
}

/** Render audit issues as a stable, copy-pasteable terminal block. */
export function formatProviderDocIssues(issues: readonly ProviderDocIssue[]): string {
  return issues.map((issue) => `- [${issue.code}] ${issue.message}`).join("\n");
}
