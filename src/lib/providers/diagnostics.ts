/**
 * Provider configuration diagnostics (I08).
 *
 * The report is intentionally built from a plain environment map: it never reads
 * credential values into its output, and unit tests can exercise production-like
 * setups without mutating process.env. Values are only used to answer
 * "present / absent"; only variable names are ever reported.
 */

export type EnvRecord = Record<string, string | undefined>;

export type ProviderStatus = "ready" | "disabled" | "degraded" | "misconfigured" | "missing";

export interface ProviderDefinition {
  id:
    | "supabase"
    | "storage"
    | "email"
    | "webpush"
    | "appark"
    | "stripe"
    | "sentry"
    | "supabase-restore"
    | "cron";
  label: string;
  keys: readonly string[];
}

export interface ProviderDiagnostic {
  id: ProviderDefinition["id"];
  label: string;
  status: ProviderStatus;
  /** Whether the provider is required for a production-ready deployment. */
  required: boolean;
  /** Whether the minimum runtime configuration is present. */
  configured: boolean;
  /** Selected runtime implementation when the provider supports a fallback. */
  provider?: string;
  /** Missing variable names only; values are never included. */
  missing: string[];
  notes: string[];
}

export interface ProviderReport {
  ok: boolean;
  mockMode: boolean;
  nodeEnv: string;
  providers: ProviderDiagnostic[];
  problems: string[];
  warnings: string[];
}

export const SUPABASE_REQUIRED_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export const SUPABASE_OPTIONAL_KEYS = ["SUPABASE_DB_URL"] as const;

export const STORAGE_KEYS = [
  "OSS_BUCKET",
  "OSS_REGION",
  "OSS_ACCESS_KEY_ID",
  "OSS_ACCESS_KEY_SECRET",
] as const;

export const EMAIL_KEYS = ["RESEND_API_KEY", "RESEND_FROM", "RESEND_API_URL"] as const;

export const WEB_PUSH_KEYS = [
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "NEXT_PUBLIC_APP_URL",
] as const;

export const APPARK_KEYS = ["NEXT_PUBLIC_APPARK_API_KEY", "NEXT_PUBLIC_APPARK_ENDPOINT"] as const;

export const STRIPE_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "STRIPE_PRO_PRICE_ID",
  "STRIPE_ENTERPRISE_PRICE_ID",
] as const;

export const SENTRY_KEYS = [
  "NEXT_PUBLIC_SENTRY_DSN",
  "SENTRY_ORG",
  "SENTRY_PROJECT",
  "SENTRY_AUTH_TOKEN",
] as const;

export const SUPABASE_RESTORE_KEYS = ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF"] as const;

export const CRON_KEYS = ["CRON_SECRET"] as const;

/**
 * Documentation contract for every supported provider. Keeping the registry in
 * the runtime module lets the docs gate fail when a provider or key is added
 * without updating the guide.
 */
export const PROVIDER_REGISTRY: readonly ProviderDefinition[] = [
  {
    id: "supabase",
    label: "Supabase core",
    keys: [...SUPABASE_REQUIRED_KEYS, ...SUPABASE_OPTIONAL_KEYS],
  },
  { id: "storage", label: "Object storage", keys: STORAGE_KEYS },
  {
    id: "email",
    label: "Resend email delivery",
    keys: EMAIL_KEYS,
  },
  { id: "webpush", label: "Web Push", keys: WEB_PUSH_KEYS },
  { id: "appark", label: "Appark APM", keys: APPARK_KEYS },
  { id: "stripe", label: "Stripe payments", keys: STRIPE_KEYS },
  { id: "sentry", label: "Sentry error monitoring", keys: SENTRY_KEYS },
  {
    id: "supabase-restore",
    label: "Supabase free-tier auto-restore",
    keys: SUPABASE_RESTORE_KEYS,
  },
  { id: "cron", label: "Cron authentication", keys: CRON_KEYS },
];

export function isMockMode(env: EnvRecord): boolean {
  return (
    env.NEXT_PUBLIC_MOCK_ENABLED === "true" ||
    (env.NODE_ENV !== "production" && !env.NEXT_PUBLIC_SUPABASE_URL)
  );
}

export function missingKeys(env: EnvRecord, keys: readonly string[]): string[] {
  return keys.filter((key) => !env[key]);
}

function hasAny(env: EnvRecord, keys: readonly string[]): boolean {
  return keys.some((key) => Boolean(env[key]));
}

function providerById(id: ProviderDefinition["id"]): ProviderDefinition {
  const match = PROVIDER_REGISTRY.find((provider) => provider.id === id);
  if (!match) throw new Error(`unknown provider definition: ${id}`);
  return match;
}

function diagnostic(
  id: ProviderDefinition["id"],
  overrides: Partial<
    Pick<
      ProviderDiagnostic,
      "status" | "required" | "configured" | "provider" | "missing" | "notes"
    >
  >,
): ProviderDiagnostic {
  const definition = providerById(id);
  return {
    id,
    label: definition.label,
    status: overrides.status ?? "disabled",
    required: overrides.required ?? false,
    configured: overrides.configured ?? false,
    provider: overrides.provider,
    missing: overrides.missing ?? [],
    notes: overrides.notes ?? [],
  };
}

function supabaseDiagnostic(env: EnvRecord, mockMode: boolean): ProviderDiagnostic {
  const requiredMissing = missingKeys(env, SUPABASE_REQUIRED_KEYS);
  const optionalMissing = missingKeys(env, SUPABASE_OPTIONAL_KEYS);
  if (requiredMissing.length > 0 && mockMode) {
    return diagnostic("supabase", {
      status: "disabled",
      required: true,
      missing: [...requiredMissing, ...optionalMissing],
      notes: ["Mock mode is active; runtime data uses the in-memory mock store."],
    });
  }
  if (requiredMissing.length > 0) {
    return diagnostic("supabase", {
      status: "missing",
      required: true,
      missing: [...requiredMissing, ...optionalMissing],
      notes: ["Set all Supabase runtime variables or enable NEXT_PUBLIC_MOCK_ENABLED."],
    });
  }
  if (optionalMissing.length > 0) {
    return diagnostic("supabase", {
      status: "degraded",
      required: true,
      configured: true,
      missing: optionalMissing,
      notes: ["Runtime is configured; database migration scripts need SUPABASE_DB_URL."],
    });
  }
  return diagnostic("supabase", {
    status: "ready",
    required: true,
    configured: true,
    notes: ["Runtime, admin client, and database migration configuration are present."],
  });
}

function storageDiagnostic(
  env: EnvRecord,
  supabaseReady: boolean,
  mockMode: boolean,
): ProviderDiagnostic {
  const missing = missingKeys(env, STORAGE_KEYS);
  const anyOss = hasAny(env, STORAGE_KEYS);
  if (missing.length === 0) {
    return diagnostic("storage", {
      status: "ready",
      configured: true,
      provider: "oss",
      notes: ["All OSS variables are present."],
    });
  }
  if (anyOss) {
    return diagnostic("storage", {
      status: "misconfigured",
      configured: false,
      provider: "supabase",
      missing,
      notes: ["Incomplete OSS configuration falls back to Supabase Storage."],
    });
  }
  if (mockMode) {
    return diagnostic("storage", {
      status: "ready",
      configured: true,
      provider: "mock",
      notes: ["Mock mode is active; no external storage provider is required."],
    });
  }
  return diagnostic("storage", {
    status: supabaseReady ? "ready" : "degraded",
    configured: supabaseReady,
    provider: "supabase",
    notes: ["OSS is not configured; Supabase Storage is the default driver."],
  });
}

function emailDiagnostic(env: EnvRecord): ProviderDiagnostic {
  const apiKeyPresent = Boolean(env.RESEND_API_KEY);
  const anyEmailConfig = hasAny(env, EMAIL_KEYS);
  if (apiKeyPresent) {
    return diagnostic("email", {
      status: "ready",
      configured: true,
      notes: ["Resend email delivery is configured."],
    });
  }
  if (anyEmailConfig) {
    return diagnostic("email", {
      status: "misconfigured",
      missing: ["RESEND_API_KEY"],
      notes: ["Resend overrides are present but the API key is missing."],
    });
  }
  return diagnostic("email", { status: "disabled", notes: ["Email delivery is off."] });
}

function pairedDiagnostic(
  id: ProviderDefinition["id"],
  env: EnvRecord,
  keys: readonly string[],
  readyNote: string,
  partialNote: string,
): ProviderDiagnostic {
  const missing = missingKeys(env, keys);
  const any = hasAny(env, keys);
  if (missing.length === 0) {
    return diagnostic(id, { status: "ready", configured: true, notes: [readyNote] });
  }
  if (any) {
    return diagnostic(id, {
      status: "misconfigured",
      missing,
      notes: [partialNote],
    });
  }
  return diagnostic(id, {
    status: "disabled",
    notes: ["Provider is not configured; this feature is off."],
  });
}

function requiredKeyDiagnostic(
  id: ProviderDefinition["id"],
  env: EnvRecord,
  keys: readonly string[],
  note: string,
): ProviderDiagnostic {
  const missing = missingKeys(env, keys);
  if (missing.length === 0) {
    return diagnostic(id, { status: "ready", configured: true, notes: [note] });
  }
  return diagnostic(id, {
    status: "disabled",
    missing,
    notes: ["Provider is not configured; this feature is off."],
  });
}

function stripeDiagnostic(env: EnvRecord): ProviderDiagnostic {
  const missing = missingKeys(env, STRIPE_KEYS);
  const any = hasAny(env, STRIPE_KEYS);
  if (missing.length === 0) {
    return diagnostic("stripe", {
      status: "ready",
      configured: true,
      notes: ["Checkout, portal, webhook verification, and plan prices are configured."],
    });
  }
  if (any) {
    return diagnostic("stripe", {
      status: "misconfigured",
      missing,
      notes: ["Stripe is partially configured; checkout or webhook delivery can fail."],
    });
  }
  return diagnostic("stripe", {
    status: "disabled",
    notes: ["Billing is off in this environment."],
  });
}

function sentryDiagnostic(env: EnvRecord): ProviderDiagnostic {
  const dsn = Boolean(env.NEXT_PUBLIC_SENTRY_DSN);
  const buildKeys = ["SENTRY_ORG", "SENTRY_PROJECT", "SENTRY_AUTH_TOKEN"] as const;
  const missingBuildKeys = missingKeys(env, buildKeys);
  const anyBuildKey = hasAny(env, buildKeys);
  if (!dsn && !anyBuildKey) {
    return diagnostic("sentry", { status: "disabled", notes: ["Error monitoring is off."] });
  }
  if (!dsn) {
    return diagnostic("sentry", {
      status: "misconfigured",
      missing: ["NEXT_PUBLIC_SENTRY_DSN"],
      notes: ["Build-time Sentry variables are present without a runtime DSN."],
    });
  }
  if (missingBuildKeys.length > 0) {
    return diagnostic("sentry", {
      status: "degraded",
      configured: true,
      missing: missingBuildKeys,
      notes: ["Runtime error capture is on; source-map upload credentials are incomplete."],
    });
  }
  return diagnostic("sentry", {
    status: "ready",
    configured: true,
    notes: ["Runtime error capture and source-map upload are configured."],
  });
}

function inferSupabaseProjectRef(env: EnvRecord): string | null {
  const explicit = env.SUPABASE_PROJECT_REF;
  if (explicit) return explicit;
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    const hostname = new URL(url).hostname;
    const match = /^([a-z0-9-]+)\.supabase\.co$/i.exec(hostname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function supabaseRestoreDiagnostic(env: EnvRecord): ProviderDiagnostic {
  const token = Boolean(env.SUPABASE_ACCESS_TOKEN);
  const explicitRef = Boolean(env.SUPABASE_PROJECT_REF);
  if (!token && !explicitRef) {
    return diagnostic("supabase-restore", {
      status: "disabled",
      notes: ["Free-tier auto-restore is off."],
    });
  }
  if (!token) {
    return diagnostic("supabase-restore", {
      status: "misconfigured",
      missing: ["SUPABASE_ACCESS_TOKEN"],
      notes: ["A project ref is available but the management access token is missing."],
    });
  }
  if (!explicitRef && !inferSupabaseProjectRef(env)) {
    return diagnostic("supabase-restore", {
      status: "misconfigured",
      missing: ["SUPABASE_PROJECT_REF"],
      notes: ["Set SUPABASE_PROJECT_REF or use a standard <ref>.supabase.co URL."],
    });
  }
  return diagnostic("supabase-restore", {
    status: "ready",
    configured: true,
    notes: ["The management API token and project reference are available."],
  });
}

/** Build a redacted, actionable report for every supported provider. */
export function diagnoseProviders(env: EnvRecord = process.env): ProviderReport {
  const mockMode = isMockMode(env);
  const supabase = supabaseDiagnostic(env, mockMode);
  const providers: ProviderDiagnostic[] = [
    supabase,
    storageDiagnostic(env, supabase.configured, mockMode),
    emailDiagnostic(env),
    pairedDiagnostic(
      "webpush",
      env,
      ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"],
      "VAPID keys are present; browser push delivery can be enabled.",
      "Only one VAPID key is present; push remains off until both keys are configured.",
    ),
    pairedDiagnostic(
      "appark",
      env,
      APPARK_KEYS,
      "Appark APM is enabled.",
      "Appark is partially configured and will stay bypassed.",
    ),
    stripeDiagnostic(env),
    sentryDiagnostic(env),
    supabaseRestoreDiagnostic(env),
    requiredKeyDiagnostic(
      "cron",
      env,
      CRON_KEYS,
      "Cron routes can authenticate scheduled callers.",
    ),
  ];

  const problems = providers
    .filter((provider) => provider.status === "missing" || provider.status === "misconfigured")
    .map(
      (provider) =>
        `${provider.id}: ${provider.status} (${provider.missing.join(", ") || provider.notes[0]})`,
    );
  const warnings = providers
    .filter((provider) => provider.status === "degraded")
    .map(
      (provider) =>
        `${provider.id}: degraded (${provider.missing.join(", ") || provider.notes[0]})`,
    );

  return {
    ok: problems.length === 0,
    mockMode,
    nodeEnv: env.NODE_ENV ?? "unknown",
    providers,
    problems,
    warnings,
  };
}

const STATUS_LABEL: Record<ProviderStatus, string> = {
  ready: "ok",
  disabled: "off",
  degraded: "warn",
  misconfigured: "error",
  missing: "missing",
};

/** Render a compact, credential-free report for terminal output. */
export function formatProviderReport(report: ProviderReport): string {
  const lines = [
    `Provider diagnostics (NODE_ENV=${report.nodeEnv}, mock=${report.mockMode ? "yes" : "no"})`,
    ...report.providers.map((provider) => {
      const fallback = provider.provider ? ` provider=${provider.provider}` : "";
      const missing = provider.missing.length > 0 ? ` missing=${provider.missing.join(",")}` : "";
      return `[${STATUS_LABEL[provider.status]}] ${provider.id} (${provider.label})${fallback}${missing}`;
    }),
  ];
  if (report.warnings.length > 0) lines.push(`Warnings: ${report.warnings.join("; ")}`);
  if (report.problems.length > 0) lines.push(`Problems: ${report.problems.join("; ")}`);
  lines.push(
    report.ok
      ? "Result: no blocking provider configuration problems."
      : "Result: blocking provider configuration problems found.",
  );
  return lines.join("\n");
}
