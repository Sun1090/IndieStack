/**
 * Static least-privilege inventory for the Supabase service-role admin client.
 *
 * `createAdminClient()` bypasses RLS, so every call site is a deliberate trust-boundary
 * decision. This module parses the TypeScript AST, inventories the exact call sites and
 * Supabase surfaces touched by each module, and fails closed when a module is unclassified,
 * grows a new call site, reaches a new table/RPC/storage bucket, or loses its documented
 * authorization evidence.
 *
 * The inventory is intentionally conservative: operations are collected per file, not per
 * variable, so a new `.from(...)` in a module that also contains a user-scoped client still
 * requires an explicit inventory review. That is preferable to silently accepting a new
 * service-role surface.
 */

import ts from "typescript";

export interface AdminClientSource {
  /** Repository-relative POSIX path, e.g. `src/lib/repositories/notifications.ts`. */
  fileName: string;
  content: string;
}

export type AdminClientSurface =
  | "trusted-worker"
  | "webhook-handler"
  | "request-handler"
  | "server-action"
  | "server-component"
  | "server-internal"
  | "auth-bridge"
  | "data-access"
  | "storage-adapter"
  | "e2e-mock-route";

export type AdminClientTrustKind =
  | "server-internal"
  | "session"
  | "role"
  | "cron-secret"
  | "webhook-signature"
  | "mock-bearer"
  | "caller-validated";

export interface AdminClientInventoryEntry {
  file: string;
  surface: AdminClientSurface;
  /** Enclosing call-site names, as a multiset. Duplicate names are intentional. */
  calls: string[];
  /** Allowlisted PostgREST tables touched anywhere in the module. */
  tables: string[];
  /** Allowlisted PostgREST RPC names touched anywhere in the module. */
  rpc: string[];
  /** Allowlisted Storage buckets touched anywhere in the module. */
  storageBuckets: string[];
  /** Allowlisted `auth.admin` method names touched anywhere in the module. */
  authAdmin: string[];
  trust: {
    kind: AdminClientTrustKind;
    /** Literal source fragments that must remain present to keep the audit honest. */
    evidence: string[];
  };
  rationale: string;
}

export type AdminClientIssueCode =
  | "ADMIN_CLIENT_UNCLASSIFIED"
  | "ADMIN_CLIENT_STALE_INVENTORY"
  | "ADMIN_CLIENT_CALL_SITE_DRIFT"
  | "ADMIN_CLIENT_CLIENT_MODULE"
  | "ADMIN_CLIENT_TABLE_NOT_ALLOWED"
  | "ADMIN_CLIENT_RPC_NOT_ALLOWED"
  | "ADMIN_CLIENT_STORAGE_BUCKET_NOT_ALLOWED"
  | "ADMIN_CLIENT_AUTH_ADMIN_NOT_ALLOWED"
  | "ADMIN_CLIENT_TRUST_EVIDENCE_MISSING";

export interface AdminClientIssue {
  code: AdminClientIssueCode;
  file: string;
  message: string;
}

export interface AdminClientFacts {
  file: string;
  calls: string[];
  tables: string[];
  rpc: string[];
  storageBuckets: string[];
  authAdmin: string[];
  clientModule: boolean;
}

export const ADMIN_CLIENT_INVENTORY: AdminClientInventoryEntry[] = [
  {
    file: "src/app/api/cron/digest/route.ts",
    surface: "trusted-worker",
    calls: ["getProfiles"],
    tables: ["profiles"],
    rpc: [],
    storageBuckets: [],
    authAdmin: [],
    trust: { kind: "cron-secret", evidence: ["checkCronAuth"] },
    rationale: "Digest worker reads recipient profiles only after the cron secret guard passes.",
  },
  {
    file: "src/app/api/e2e/contact-messages/route.ts",
    surface: "e2e-mock-route",
    calls: ["DELETE", "GET", "POST"],
    tables: ["contact_messages"],
    rpc: [],
    storageBuckets: [],
    authAdmin: [],
    trust: { kind: "mock-bearer", evidence: ["isMockEnabled", "E2E_BEARER_TOKEN"] },
    rationale: "Mock-only E2E fixture endpoint for contact-message list, seed and reset.",
  },
  {
    file: "src/app/api/e2e/email-worker-runs/route.ts",
    surface: "e2e-mock-route",
    calls: ["GET"],
    tables: ["email_worker_runs"],
    rpc: [],
    storageBuckets: [],
    authAdmin: [],
    trust: { kind: "mock-bearer", evidence: ["isMockEnabled", "E2E_BEARER_TOKEN"] },
    rationale: "Mock-only E2E read endpoint for digest worker run records.",
  },
  {
    file: "src/app/api/e2e/push-queue/route.ts",
    surface: "e2e-mock-route",
    calls: [
      "DELETE",
      "GET",
      "POST",
      "seedNotification",
      "seedSubscription",
      "setPushPreference",
    ],
    tables: ["notifications", "profiles", "push_delivery_attempts", "push_subscriptions"],
    rpc: [],
    storageBuckets: [],
    authAdmin: [],
    trust: { kind: "mock-bearer", evidence: ["isMockEnabled", "E2E_BEARER_TOKEN"] },
    rationale: "Mock-only E2E push queue fixture for retry, backlog and cleanup assertions.",
  },
  {
    file: "src/app/api/e2e/seed-notifications/route.ts",
    surface: "e2e-mock-route",
    calls: ["DELETE", "GET", "POST"],
    tables: ["notifications"],
    rpc: [],
    storageBuckets: [],
    authAdmin: [],
    trust: { kind: "mock-bearer", evidence: ["isMockEnabled", "E2E_BEARER_TOKEN"] },
    rationale: "Mock-only E2E notification fixture for realtime and mail-flow assertions.",
  },
  {
    file: "src/app/api/e2e/webhook-events/route.ts",
    surface: "e2e-mock-route",
    calls: ["DELETE"],
    tables: ["webhook_events"],
    rpc: [],
    storageBuckets: [],
    authAdmin: [],
    trust: { kind: "mock-bearer", evidence: ["isMockEnabled", "E2E_BEARER_TOKEN"] },
    rationale: "Mock-only E2E reset endpoint for webhook idempotency assertions.",
  },
  {
    file: "src/app/api/invitations/route.ts",
    surface: "request-handler",
    calls: ["DELETE", "POST"],
    tables: ["profiles", "team_members", "teams"],
    rpc: [],
    storageBuckets: [],
    authAdmin: [],
    trust: {
      kind: "role",
      evidence: ["supabase.auth.getUser", "PERMISSIONS.team.remove", "Only team admins"],
    },
    rationale:
      "Invite and removal handlers authenticate the caller and verify owner/admin membership before using service_role for cross-user writes.",
  },
  {
    file: "src/app/api/webhooks/stripe/route.ts",
    surface: "webhook-handler",
    calls: [
      "markSubscriptionCanceled",
      "notifyTeamOwner",
      "resolveTeamId",
      "upsertSubscription",
    ],
    tables: ["subscriptions", "team_members"],
    rpc: [],
    storageBuckets: [],
    authAdmin: [],
    trust: {
      kind: "webhook-signature",
      evidence: ["constructEvent", "STRIPE_WEBHOOK_SECRET"],
    },
    rationale: "Stripe events are processed only after SDK signature verification.",
  },
  {
    file: "src/app/dashboard/admin/page.tsx",
    surface: "server-component",
    calls: ["AdminPage"],
    tables: ["profiles", "teams"],
    rpc: [],
    storageBuckets: [],
    authAdmin: [],
    trust: { kind: "role", evidence: ["safelyRequireRole"] },
    rationale: "Admin dashboard reads platform aggregates after the admin role guard.",
  },
  {
    file: "src/lib/account/deletion.ts",
    surface: "server-internal",
    calls: ["deleteAccountWithData"],
    tables: [],
    rpc: [],
    storageBuckets: [],
    authAdmin: ["deleteUser"],
    trust: { kind: "caller-validated", evidence: ["deleteUser(userId)", "eraseAccountData(userId)"] },
    rationale:
      "Account deletion erases cascade-invisible personal data first, and only then deletes the caller-validated own user id; the route handler and the server action both authorize the session before calling it.",
  },
  {
    file: "src/lib/actions/admin.ts",
    surface: "server-action",
    calls: ["listAdminUsers", "updateUserRole"],
    tables: ["profiles"],
    rpc: [],
    storageBuckets: [],
    authAdmin: [],
    trust: { kind: "role", evidence: ["safelyRequireRole"] },
    rationale: "Admin user actions check the caller's role before reading or mutating profiles.",
  },
  {
    file: "src/lib/actions/recovery-codes.ts",
    surface: "server-action",
    calls: ["redeemRecoveryCode"],
    tables: [],
    rpc: [],
    storageBuckets: [],
    authAdmin: ["deleteFactor", "listFactors"],
    trust: { kind: "session", evidence: ["supabase.auth.getUser", "timingSafeEqual"] },
    rationale:
      "Recovery-code redemption requires the signed-in user and a timing-safe code match before TOTP factors are removed.",
  },
  {
    file: "src/lib/actions/team.ts",
    surface: "server-action",
    calls: ["createTeam", "inviteMember", "removeMember"],
    tables: ["team_members", "teams"],
    rpc: [],
    storageBuckets: [],
    authAdmin: [],
    trust: { kind: "session", evidence: ["supabase.auth.getUser"] },
    rationale:
      "Team actions require an authenticated user and perform ownership/role checks before cross-user writes.",
  },
  {
    file: "src/lib/auth/passkey-session.ts",
    surface: "auth-bridge",
    calls: ["establishPasskeySession"],
    tables: [],
    rpc: [],
    storageBuckets: [],
    authAdmin: ["generateLink", "getUserById"],
    trust: { kind: "caller-validated", evidence: ["调用方必须先确认"] },
    rationale:
      "The WebAuthn assertion is validated by callers before this bridge mints an Auth session; tokens never leave the server.",
  },
  {
    file: "src/lib/email-notify.ts",
    surface: "server-internal",
    calls: ["fetchProfile"],
    tables: ["profiles"],
    rpc: [],
    storageBuckets: [],
    authAdmin: [],
    trust: { kind: "server-internal", evidence: [] },
    rationale: "Notification helper resolves recipient preferences for trusted server workflows.",
  },
  {
    file: "src/lib/repositories/account-erasure.ts",
    surface: "data-access",
    calls: ["eraseAccountData"],
    tables: [],
    rpc: ["erase_user_data"],
    storageBuckets: [],
    authAdmin: [],
    trust: { kind: "server-internal", evidence: [] },
    rationale:
      "erase_user_data is a security-definer RPC that migration 032 revokes from anon/authenticated and grants only to service_role; the table itself stays RLS deny-all.",
  },
  {
    file: "src/lib/repositories/admin-users.ts",
    surface: "data-access",
    calls: ["listAdminUsersPage"],
    tables: ["profiles"],
    rpc: [],
    storageBuckets: [],
    authAdmin: [],
    trust: { kind: "server-internal", evidence: [] },
    rationale: "Admin user pagination; callers enforce the admin role guard.",
  },
  {
    file: "src/lib/repositories/audit-logs.ts",
    surface: "data-access",
    calls: ["appendAuditLog", "listAuditLogsPage"],
    tables: ["audit_logs"],
    rpc: [],
    storageBuckets: [],
    authAdmin: [],
    trust: { kind: "server-internal", evidence: [] },
    rationale: "Audit logs are append-only server data and intentionally inaccessible to clients.",
  },
  {
    file: "src/lib/repositories/contact-messages.ts",
    surface: "data-access",
    calls: [
      "countContactMessages",
      "listContactMessagesPage",
      "listRecentContactMessages",
      "setMessageStatus",
    ],
    tables: ["contact_messages"],
    rpc: [],
    storageBuckets: [],
    authAdmin: [],
    trust: { kind: "server-internal", evidence: [] },
    rationale: "Contact messages are platform-admin data; callers enforce admin authorization.",
  },
  {
    file: "src/lib/repositories/marketing.ts",
    surface: "data-access",
    calls: [
      "deactivateSubscription",
      "getSubscriptionByUserId",
      "listSubscribedEmails",
      "updateStatusByToken",
      "upsertPendingSubscription",
    ],
    tables: ["marketing_subscriptions"],
    rpc: [],
    storageBuckets: [],
    authAdmin: [],
    trust: { kind: "server-internal", evidence: [] },
    rationale:
      "Marketing subscription state is keyed by opaque token or trusted admin/worker workflows.",
  },
  {
    file: "src/lib/repositories/mfa-recovery-codes.ts",
    surface: "data-access",
    calls: [
      "consumeRecoveryCode",
      "hasUnusedRecoveryCodes",
      "listUnusedRecoveryCodes",
      "replaceRecoveryCodes",
    ],
    tables: ["mfa_recovery_codes"],
    rpc: [],
    storageBuckets: [],
    authAdmin: [],
    trust: { kind: "server-internal", evidence: [] },
    rationale: "Recovery-code hashes stay server-only; actions scope each operation to the user id.",
  },
  {
    file: "src/lib/repositories/notifications.ts",
    surface: "data-access",
    calls: [
      "countUnsentEmailNotifications",
      "createNotification",
      "listDeadLetterNotifications",
      "listNotificationsByIds",
      "listUnsentEmailNotifications",
      "markEmailFailed",
      "markEmailSent",
      "oldestUnsentEmailCreatedAt",
    ],
    tables: ["notifications"],
    rpc: [],
    storageBuckets: [],
    authAdmin: [],
    trust: { kind: "server-internal", evidence: [] },
    rationale:
      "Notification queue and delivery state are maintained by trusted server workers and read back by the admin overview panel.",
  },
  {
    file: "src/lib/repositories/profiles.ts",
    surface: "data-access",
    calls: ["findUserIdByEmail", "listNotificationSettingsByIds"],
    tables: ["profiles"],
    rpc: [],
    storageBuckets: [],
    authAdmin: [],
    trust: { kind: "server-internal", evidence: [] },
    rationale:
      "Cross-user profile lookup and recipient preference reads support authorized invites and workers.",
  },
  {
    file: "src/lib/repositories/push-delivery-attempts.ts",
    surface: "data-access",
    calls: [
      "countDeadLetterPushDeliveries",
      "countInvalidPushEndpoints",
      "countPendingPushDeliveries",
      "enqueuePushDeliveryAttempts",
      "listDeadLetterPushDeliveries",
      "listDuePushDeliveryAttempts",
      "markPushDeliveryDead",
      "markPushDeliveryRetry",
      "markPushDeliverySent",
      "pruneTerminalRows",
    ],
    tables: ["push_delivery_attempts"],
    rpc: [],
    storageBuckets: [],
    authAdmin: [],
    trust: { kind: "server-internal", evidence: [] },
    rationale: "Push delivery queue state is exclusively a trusted worker concern.",
  },
  {
    file: "src/lib/repositories/push-subscriptions.ts",
    surface: "data-access",
    calls: ["getPushSubscriptionById", "listPushSubscriptions", "removePushSubscription"],
    tables: ["push_subscriptions"],
    rpc: [],
    storageBuckets: [],
    authAdmin: [],
    trust: { kind: "server-internal", evidence: [] },
    rationale:
      "Push subscription endpoints are needed server-side for delivery; user-visible access remains RLS-scoped.",
  },
  {
    file: "src/lib/repositories/retention.ts",
    surface: "data-access",
    calls: ["runRetentionSweeps"],
    tables: [],
    rpc: [
      "cleanup_old_notifications",
      "cleanup_old_webhook_events",
      "cleanup_old_email_worker_runs",
      "cleanup_old_api_usage",
      "prune_deleted_upload_objects",
      "cleanup_resolved_contact_messages",
    ],
    storageBuckets: [],
    authAdmin: [],
    trust: { kind: "server-internal", evidence: [] },
    rationale:
      "Every retention cleanup is a security-definer function that migrations 028/032 revoke from anon/authenticated and grant only to service_role; the worker triggers them and never reads row data back into a response.",
  },
  {
    file: "src/lib/repositories/teams.ts",
    surface: "data-access",
    calls: ["syncTeamMemberCount"],
    tables: ["team_members", "teams"],
    rpc: [],
    storageBuckets: [],
    authAdmin: [],
    trust: { kind: "server-internal", evidence: [] },
    rationale:
      "teams.member_count is a server-maintained derived cache (migration 007 revokes member writes to that column); recounting it has to count membership rows across users, which an RLS-scoped client cannot do consistently.",
  },
  {
    file: "src/lib/repositories/upload-objects.ts",
    surface: "data-access",
    calls: [
      "listObjectsForErasure",
      "listOrphanObjects",
      "markUploadObjectDeleted",
      "recordUploadObject",
    ],
    tables: ["upload_objects"],
    rpc: ["find_orphan_upload_objects", "list_user_objects_for_erasure"],
    storageBuckets: [],
    authAdmin: [],
    trust: { kind: "server-internal", evidence: [] },
    rationale:
      "Upload metadata rows are written only after the upload service validated the caller, session and file; the table stays RLS deny-all (migration 031). The two RPCs (migration 033) read every profile/project URL column to decide reference state, so they are security-definer and service-role only.",
  },
  {
    file: "src/lib/repositories/webauthn.ts",
    surface: "data-access",
    calls: ["createCredential", "findCredentialById", "updateCredentialCounter"],
    tables: ["webauthn_credentials"],
    rpc: [],
    storageBuckets: [],
    authAdmin: [],
    trust: { kind: "server-internal", evidence: [] },
    rationale: "WebAuthn credential material is server-only and scoped by validated ceremonies.",
  },
  {
    file: "src/lib/repositories/webhook-events.ts",
    surface: "data-access",
    calls: [
      "claimWebhookEvent",
      "countWebhookEvents",
      "finalizeWebhookEvent",
      "listRecentWebhookEvents",
    ],
    tables: ["webhook_events"],
    // claim_webhook_event 是幂等占位 RPC：SECURITY DEFINER + 只授 service_role（迁移 030）
    rpc: ["claim_webhook_event"],
    storageBuckets: [],
    authAdmin: [],
    trust: { kind: "server-internal", evidence: [] },
    rationale:
      "Webhook idempotency records are claimed and read only by trusted server paths; the claim RPC is service_role-only.",
  },
  {
    file: "src/lib/repositories/worker-runs.ts",
    surface: "data-access",
    calls: ["listRecentEmailWorkerRuns", "recordWorkerRun"],
    tables: ["email_worker_runs"],
    rpc: [],
    storageBuckets: [],
    authAdmin: [],
    trust: { kind: "server-internal", evidence: [] },
    rationale:
      "Worker run telemetry is written by the cron worker through service_role and read back by the admin overview panel.",
  },
  {
    file: "src/lib/storage/index.ts",
    surface: "storage-adapter",
    calls: ["supabaseDriver.put", "supabaseDriver.remove", "supabaseDriver.signedUrl"],
    tables: [],
    rpc: [],
    storageBuckets: ["avatars"],
    authAdmin: [],
    trust: { kind: "server-internal", evidence: [] },
    rationale:
      "The storage adapter keeps uploads in a fixed bucket; callers enforce file validation and ownership.",
  },
];

function scriptKind(fileName: string): ts.ScriptKind {
  return fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function stringArgument(call: ts.CallExpression): string | null {
  const argument = call.arguments[0];
  if (!argument) return null;
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
    return argument.text;
  }
  return null;
}

function callOwner(node: ts.Node): string {
  const names: string[] = [];
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) {
      names.push(current.name.text);
    } else if (ts.isMethodDeclaration(current) && current.name) {
      names.push(current.name.getText());
    } else if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      ts.isVariableDeclaration(current.parent) &&
      ts.isIdentifier(current.parent.name)
    ) {
      names.push(current.parent.name.text);
    }
    current = current.parent;
  }
  return names.length ? names.reverse().join(".") : "<module>";
}

function authAdminMethod(base: ts.PropertyAccessExpression): string | null {
  let current: ts.Node = base;
  while (ts.isPropertyAccessExpression(current.parent)) current = current.parent;
  if (ts.isCallExpression(current.parent) && current.parent.expression === current) {
    return ts.isPropertyAccessExpression(current) ? current.name.text : null;
  }
  return null;
}

/**
 * Built-ins that expose a `.from()` helper with unrelated semantics. `Buffer.from("x")` copies
 * bytes and `Array.from(source)` materialises an iterable; neither is a PostgREST table read.
 * Without this denylist every `Buffer.from(...)` inside a module that also calls
 * `createAdminClient()` would demand a bogus inventory entry. Unknown receivers stay
 * conservative: they are still treated as PostgREST access.
 */
const NON_SUPABASE_FROM_RECEIVERS = new Set([
  "Array",
  "ArrayBuffer",
  "BigInt64Array",
  "BigUint64Array",
  "Buffer",
  "DataView",
  "Float32Array",
  "Float64Array",
  "Int16Array",
  "Int32Array",
  "Int8Array",
  "SharedArrayBuffer",
  "String",
  "Uint16Array",
  "Uint32Array",
  "Uint8Array",
  "Uint8ClampedArray",
]);

/**
 * `Buffer.from(...)` is not a Supabase call. Match only the trailing identifier so globals such
 * as `globalThis.Buffer` are recognised while application clients named `bufferClient` are not.
 */
function isNonSupabaseFromReceiver(receiver: string): boolean {
  const head = receiver.split(".").slice(-1)[0];
  return head !== undefined && NON_SUPABASE_FROM_RECEIVERS.has(head);
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/** Mutable per-file accumulator for the Supabase surfaces a module touches. */
interface AdminClientSurfaces {
  tables: string[];
  rpc: string[];
  storageBuckets: string[];
  authAdmin: string[];
}

function collectAdminClientCall(node: ts.Node, calls: string[]): void {
  if (!ts.isCallExpression(node)) return;
  if (!ts.isIdentifier(node.expression)) return;
  if (node.expression.text !== "createAdminClient") return;
  calls.push(callOwner(node));
}

/** `storage.from("avatars")` names a bucket; every other `.from(...)` names a table. */
function collectFromCall(
  receiver: string,
  argument: string,
  surfaces: AdminClientSurfaces,
): void {
  if (receiver === "storage" || receiver.endsWith(".storage")) {
    surfaces.storageBuckets.push(argument);
    return;
  }
  if (!isNonSupabaseFromReceiver(receiver)) surfaces.tables.push(argument);
}

function collectAuthAdminCall(
  expression: ts.PropertyAccessExpression,
  parsed: ts.SourceFile,
  surfaces: AdminClientSurfaces,
): void {
  const base = expression.expression;
  if (!ts.isPropertyAccessExpression(base)) return;
  if (!base.getText(parsed).endsWith(".auth.admin")) return;
  const method = authAdminMethod(base);
  if (method) surfaces.authAdmin.push(method);
}

function collectSupabaseOperation(
  node: ts.Node,
  parsed: ts.SourceFile,
  surfaces: AdminClientSurfaces,
): void {
  if (!ts.isCallExpression(node)) return;
  if (!ts.isPropertyAccessExpression(node.expression)) return;
  const method = node.expression.name.text;
  const argument = stringArgument(node);
  if (method === "from" && argument) {
    collectFromCall(node.expression.expression.getText(parsed), argument, surfaces);
  }
  if (method === "rpc" && argument) surfaces.rpc.push(argument);
  collectAuthAdminCall(node.expression, parsed, surfaces);
}

export function collectAdminClientFacts(sources: AdminClientSource[]): AdminClientFacts[] {
  const facts: AdminClientFacts[] = [];

  for (const source of sources) {
    const parsed = ts.createSourceFile(
      source.fileName,
      source.content,
      ts.ScriptTarget.Latest,
      true,
      scriptKind(source.fileName),
    );
    const calls: string[] = [];
    const surfaces: AdminClientSurfaces = {
      tables: [],
      rpc: [],
      storageBuckets: [],
      authAdmin: [],
    };

    const visit = (node: ts.Node): void => {
      collectAdminClientCall(node, calls);
      collectSupabaseOperation(node, parsed, surfaces);
      ts.forEachChild(node, visit);
    };
    visit(parsed);

    if (calls.length === 0) continue;
    facts.push({
      file: source.fileName,
      calls: calls.sort(),
      tables: sortedUnique(surfaces.tables),
      rpc: sortedUnique(surfaces.rpc),
      storageBuckets: sortedUnique(surfaces.storageBuckets),
      authAdmin: sortedUnique(surfaces.authAdmin),
      clientModule: /["']use client["']/.test(source.content),
    });
  }

  return facts;
}

function sameStrings(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function missingValues(actual: string[], allowed: string[]): string[] {
  const allowedSet = new Set(allowed);
  return actual.filter((value) => !allowedSet.has(value));
}

function operationIssue(
  facts: AdminClientFacts,
  code: AdminClientIssueCode,
  field: string,
  values: string[],
): AdminClientIssue {
  return {
    code,
    file: facts.file,
    message: `${facts.file}: ${field} not in service-role inventory: ${values.join(", ")}`,
  };
}

function compareEntry(facts: AdminClientFacts, entry: AdminClientInventoryEntry): AdminClientIssue[] {
  const issues: AdminClientIssue[] = [];
  const expectedCalls = [...entry.calls].sort();

  if (!sameStrings(facts.calls, expectedCalls)) {
    issues.push({
      code: "ADMIN_CLIENT_CALL_SITE_DRIFT",
      file: facts.file,
      message:
        `${facts.file}: call sites changed; expected [${expectedCalls.join(", ")}], ` +
        `found [${facts.calls.join(", ")}]`,
    });
  }

  if (facts.clientModule) {
    issues.push({
      code: "ADMIN_CLIENT_CLIENT_MODULE",
      file: facts.file,
      message: `${facts.file}: a client module references createAdminClient()`,
    });
  }

  const tables = missingValues(facts.tables, entry.tables);
  if (tables.length) {
    issues.push(
      operationIssue(facts, "ADMIN_CLIENT_TABLE_NOT_ALLOWED", "table access", tables),
    );
  }
  const rpc = missingValues(facts.rpc, entry.rpc);
  if (rpc.length) {
    issues.push(operationIssue(facts, "ADMIN_CLIENT_RPC_NOT_ALLOWED", "RPC access", rpc));
  }
  const buckets = missingValues(facts.storageBuckets, entry.storageBuckets);
  if (buckets.length) {
    issues.push(
      operationIssue(
        facts,
        "ADMIN_CLIENT_STORAGE_BUCKET_NOT_ALLOWED",
        "storage bucket",
        buckets,
      ),
    );
  }
  const authAdmin = missingValues(facts.authAdmin, entry.authAdmin);
  if (authAdmin.length) {
    issues.push(
      operationIssue(
        facts,
        "ADMIN_CLIENT_AUTH_ADMIN_NOT_ALLOWED",
        "Auth admin method",
        authAdmin,
      ),
    );
  }

  return issues;
}

export function inspectAdminClientBoundary(
  sources: AdminClientSource[],
  inventory: AdminClientInventoryEntry[] = ADMIN_CLIENT_INVENTORY,
): AdminClientIssue[] {
  const issues: AdminClientIssue[] = [];
  const facts = collectAdminClientFacts(sources);
  const sourceByFile = new Map(sources.map((source) => [source.fileName, source.content]));
  const inventoryByFile = new Map(inventory.map((entry) => [entry.file, entry]));

  for (const fact of facts) {
    const entry = inventoryByFile.get(fact.file);
    if (!entry) {
      issues.push({
        code: "ADMIN_CLIENT_UNCLASSIFIED",
        file: fact.file,
        message:
          `${fact.file}: ${fact.calls.length} createAdminClient() call site(s) are not classified ` +
          "in ADMIN_CLIENT_INVENTORY",
      });
      continue;
    }
    issues.push(...compareEntry(fact, entry));
    const source = sourceByFile.get(fact.file) ?? "";
    for (const evidence of entry.trust.evidence) {
      if (!source.includes(evidence)) {
        issues.push({
          code: "ADMIN_CLIENT_TRUST_EVIDENCE_MISSING",
          file: fact.file,
          message: `${fact.file}: trust evidence "${evidence}" is missing`,
        });
      }
    }
  }

  for (const entry of inventory) {
    if (!facts.some((fact) => fact.file === entry.file)) {
      issues.push({
        code: "ADMIN_CLIENT_STALE_INVENTORY",
        file: entry.file,
        message: `${entry.file}: inventory entry has no createAdminClient() call site`,
      });
    }
  }

  return issues;
}
