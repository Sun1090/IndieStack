/**
 * Static audit of every object-storage bucket the application talks to.
 *
 * The previous storage gate was written around one literal: it looked for
 * `storage.from("avatars")` inside `src/lib/storage/index.ts`, then required four policy names by
 * regex. That is a blind spot with two failure modes:
 *
 *   - a second bucket referenced anywhere else in the tree ships with no versioned bucket row,
 *     no RLS policy and no reviewer attention, and
 *   - renaming or rewriting a policy keeps passing as long as the *old* names still appear
 *     somewhere in the migration corpus.
 *
 * Buckets are discovered from the source tree and cross-checked against the migrated policy set,
 * so the audit follows the code instead of a hardcoded name. Rules:
 *
 *   - every bucket referenced by app code (or by a `storage.objects` policy) must be declared in
 *     `STORAGE_BUCKET_INVENTORY` together with its read model — a new bucket fails closed;
 *   - a declared bucket must be created by a migration (`insert into storage.buckets`), because the
 *     Supabase driver always writes to that bucket id even when the OSS driver is active;
 *   - a referenced bucket must carry at least one effective `storage.objects` policy;
 *   - a declared public bucket must expose exactly the client read access it declares, and a
 *     private bucket must not carry any client read policy;
 *   - client write policies must pin the bucket *and* the caller's own folder (`auth.uid()`),
 *     otherwise one tenant can overwrite another tenant's object.
 *
 * Scope note: this is a static gate over migrations and source files. The effective policy list
 * comes from `client-write-policies.ts`, so `drop policy` in a later migration removes coverage.
 */

import { extractEffectivePolicies, splitSqlStatements, type PolicyStatement } from "./client-write-policies.ts";
import type { SecuritySource } from "./security-definer-grants";

/** Read model of a bucket: who may read objects, and how client writes must be bounded. */
export interface StorageBucketModel {
  /** `public`: anon/authenticated read objects directly; `private`: only service_role reads. */
  read: "public" | "private";
  /** Client write policies must pin rows to the caller's own folder (`auth.uid()`). */
  tenantScopedWrites: boolean;
  reason: string;
}

/**
 * Buckets the application is allowed to touch. Every entry is a reviewed decision; adding a bucket
 * to the code (or to a policy) without adding it here fails the gate.
 */
export const STORAGE_BUCKET_INVENTORY: Record<string, StorageBucketModel> = {
  avatars: {
    read: "public",
    tenantScopedWrites: true,
    reason: "头像与项目封面的公共读 bucket；客户端只能写自己 userId 目录",
  },
};

export type StoragePolicyIssueCode =
  | "STORAGE_BUCKET_UNDECLARED"
  | "STORAGE_BUCKET_UNVERSIONED"
  | "STORAGE_BUCKET_UNPOLICED"
  | "STORAGE_WRITE_POLICY_UNSCOPED"
  | "STORAGE_READ_POLICY_UNSCOPED"
  | "STORAGE_PRIVATE_BUCKET_PUBLIC_READ"
  | "STORAGE_PUBLIC_BUCKET_UNREADABLE";

export interface StoragePolicyIssue {
  code: StoragePolicyIssueCode;
  bucket?: string;
  policy?: string;
  fileName?: string;
  message: string;
}

export interface StoragePolicyAudit {
  issues: StoragePolicyIssue[];
  warnings: string[];
}

export interface StoragePolicyInput {
  /** Ordered migration sources (the effective policy set is reduced from these). */
  migrations: SecuritySource[];
  /** Application `src/**` files used to discover referenced buckets; test files excluded. */
  appSources: SecuritySource[];
  inventory?: Record<string, StorageBucketModel>;
}

const CLIENT_ROLES = new Set(["public", "anon", "authenticated"]);
const WRITE_COMMANDS = new Set(["insert", "update", "delete", "all"]);
const READ_COMMANDS = new Set(["select", "all"]);

const STORAGE_FROM = /\.storage\s*\.\s*from\s*\(\s*["'`]([a-z0-9][a-z0-9_-]*)["'`]\s*\)/gi;
const CREATE_BUCKET = /insert\s+into\s+storage\.buckets[\s\S]*?values\s*\(([\s\S]*?)\)/i;
const BUCKET_LITERAL = /'([a-z0-9][a-z0-9_-]*)'/gi;
const BUCKET_FILTER = (bucket: string) =>
  new RegExp(`bucket_id\\s*=\\s*'${bucket.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`, "i");
const BUCKET_ID_ANY = /bucket_id\s*=/i;
const TENANT_BOUNDARY = /storage\s*\.\s*foldername/i;
const OWNER_BOUNDARY = /auth\s*\.\s*uid\s*\(\s*\)/i;

function isClientFacing(policy: PolicyStatement): boolean {
  return policy.roles.some((role) => CLIENT_ROLES.has(role));
}

function isStorageObjectsPolicy(policy: PolicyStatement): boolean {
  return policy.table === "storage.objects";
}

/** The clause that actually governs the command: PostgREST/PostgreSQL defaults differ per command. */
function governingClause(policy: PolicyStatement): string | null {
  if (policy.command === "insert") return policy.withCheck;
  if (policy.command === "update") return policy.withCheck ?? policy.using;
  return policy.using ?? policy.withCheck;
}

function clauses(policy: PolicyStatement): string[] {
  return [policy.using, policy.withCheck].filter((value): value is string => value !== null);
}

/** Buckets named by `bucket_id = '...'` anywhere in a policy's predicates. */
function policyBuckets(policy: PolicyStatement): string[] {
  const found = new Set<string>();
  for (const clause of clauses(policy)) {
    for (const match of clause.matchAll(/bucket_id\s*=\s*'([a-z0-9][a-z0-9_-]*)'/gi)) {
      found.add(match[1].toLowerCase());
    }
  }
  return [...found];
}

function coversBucket(policy: PolicyStatement, bucket: string): boolean {
  const filter = BUCKET_FILTER(bucket);
  return clauses(policy).some((clause) => filter.test(clause));
}

/** Buckets referenced by application code through `storage.from("<bucket>")`. */
export function discoverStorageBuckets(appSources: SecuritySource[]): string[] {
  const buckets = new Set<string>();
  for (const source of appSources) {
    STORAGE_FROM.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = STORAGE_FROM.exec(source.content)) !== null) {
      buckets.add(match[1].toLowerCase());
    }
  }
  return [...buckets].sort();
}

/** Buckets created by `insert into storage.buckets` in the ordered migrations. */
export function collectVersionedBuckets(migrations: SecuritySource[]): string[] {
  const buckets = new Set<string>();
  for (const source of migrations) {
    for (const statement of splitSqlStatements(source.content)) {
      const created = CREATE_BUCKET.exec(statement);
      if (!created) continue;
      BUCKET_LITERAL.lastIndex = 0;
      let literal: RegExpExecArray | null;
      while ((literal = BUCKET_LITERAL.exec(created[1])) !== null) {
        buckets.add(literal[1].toLowerCase());
      }
    }
  }
  return [...buckets].sort();
}

/** Effective, client-facing `storage.objects` policies reduced from the migrations. */
export function collectStoragePolicies(migrations: SecuritySource[]): PolicyStatement[] {
  return extractEffectivePolicies(migrations).filter(
    (policy) => isStorageObjectsPolicy(policy) && isClientFacing(policy),
  );
}

function undeclaredIssues(
  candidates: string[],
  inventory: Record<string, StorageBucketModel>,
): StoragePolicyIssue[] {
  return candidates
    .filter((bucket) => !Object.prototype.hasOwnProperty.call(inventory, bucket))
    .map((bucket) => ({
      code: "STORAGE_BUCKET_UNDECLARED" as const,
      bucket,
      message:
        `storage.objects: bucket "${bucket}" is referenced by code or a policy but is not ` +
        `declared in STORAGE_BUCKET_INVENTORY, so nobody reviewed its read model`,
    }));
}

function bucketCoverageIssues(
  buckets: string[],
  versioned: string[],
  policies: PolicyStatement[],
): StoragePolicyIssue[] {
  const issues: StoragePolicyIssue[] = [];

  for (const bucket of buckets) {
    if (!versioned.includes(bucket)) {
      issues.push({
        code: "STORAGE_BUCKET_UNVERSIONED",
        bucket,
        message:
          `storage.buckets: bucket "${bucket}" is used by the application but no migration ` +
          `creates it; the Supabase driver always writes to that bucket id`,
      });
    }
    if (!policies.some((policy) => coversBucket(policy, bucket))) {
      issues.push({
        code: "STORAGE_BUCKET_UNPOLICED",
        bucket,
        message:
          `storage.objects: bucket "${bucket}" has no effective RLS policy, so PostgREST ` +
          `rejects every client read and write`,
      });
    }
  }

  return issues;
}

function writeScopeIssues(policies: PolicyStatement[], bucket: string): StoragePolicyIssue[] {
  const issues: StoragePolicyIssue[] = [];
  for (const policy of policies) {
    if (!WRITE_COMMANDS.has(policy.command) || !coversBucket(policy, bucket)) continue;
    const clause = governingClause(policy);
    const issue =
      clause === null
        ? `has no WITH CHECK clause, so PostgreSQL accepts every row`
        : !TENANT_BOUNDARY.test(clause) || !OWNER_BOUNDARY.test(clause)
          ? `does not pin the caller's own folder (storage.foldername + auth.uid())`
          : null;
    if (issue) {
      issues.push({
        code: "STORAGE_WRITE_POLICY_UNSCOPED",
        bucket,
        policy: policy.name,
        fileName: policy.fileName,
        message:
          `storage.objects: ${policy.command.toUpperCase()} policy "${policy.name}" on bucket ` +
          `"${bucket}" ${issue}`,
      });
    }
  }
  return issues;
}

function readScopeIssues(policies: PolicyStatement[]): StoragePolicyIssue[] {
  return policies
    .filter((policy) => READ_COMMANDS.has(policy.command) && policy.using !== null)
    .filter((policy) => !BUCKET_ID_ANY.test(policy.using ?? ""))
    .map((policy) => ({
      code: "STORAGE_READ_POLICY_UNSCOPED" as const,
      policy: policy.name,
      fileName: policy.fileName,
      message:
        `storage.objects: SELECT policy "${policy.name}" for ${policy.roles.join(", ")} has no ` +
        `bucket_id filter, so it exposes every bucket`,
    }));
}

function readModelIssues(
  policy: PolicyStatement[],
  bucket: string,
  model: StorageBucketModel,
): StoragePolicyIssue[] {
  const covering = policy.filter((item) => coversBucket(item, bucket));
  if (model.read === "private") {
    const readPolicies = covering.filter((item) => READ_COMMANDS.has(item.command));
    if (readPolicies.length === 0) return [];
    return [
      {
        code: "STORAGE_PRIVATE_BUCKET_PUBLIC_READ",
        bucket,
        policy: readPolicies[0].name,
        fileName: readPolicies[0].fileName,
        message:
          `storage.objects: bucket "${bucket}" is declared private but policy ` +
          `"${readPolicies[0].name}" grants client reads`,
      },
    ];
  }
  if (covering.some((item) => READ_COMMANDS.has(item.command))) return [];
  return [
    {
      code: "STORAGE_PUBLIC_BUCKET_UNREADABLE",
      bucket,
      message:
        `storage.objects: bucket "${bucket}" is declared public-read but no policy grants ` +
        `client SELECT, so public object URLs cannot be produced by policy review`,
    },
  ];
}

/**
 * Inspect the buckets referenced by the application against the migrated bucket rows and the
 * effective `storage.objects` policy set.
 */
export function inspectStoragePolicies(input: StoragePolicyInput): StoragePolicyAudit {
  const inventory = input.inventory ?? STORAGE_BUCKET_INVENTORY;
  const used = discoverStorageBuckets(input.appSources);
  const policies = collectStoragePolicies(input.migrations);
  const declared = [
    ...new Set([...used, ...policies.flatMap((policy) => policyBuckets(policy))]),
  ].sort();

  const issues: StoragePolicyIssue[] = [
    ...undeclaredIssues(declared, inventory),
    ...bucketCoverageIssues(declared, collectVersionedBuckets(input.migrations), policies),
    ...readScopeIssues(policies),
  ];

  for (const bucket of declared) {
    const model = inventory[bucket];
    if (!model) continue;
    issues.push(...readModelIssues(policies, bucket, model));
    if (model.tenantScopedWrites) issues.push(...writeScopeIssues(policies, bucket));
  }

  // A bucket nobody references any more is a stale review decision, not a security hole.
  const warnings = Object.keys(inventory)
    .filter((bucket) => !used.includes(bucket))
    .map(
      (bucket) =>
        `storage.buckets: bucket "${bucket}" is declared in STORAGE_BUCKET_INVENTORY but no ` +
        `application code references it — the inventory entry may be stale`,
    );

  return { issues, warnings };
}
