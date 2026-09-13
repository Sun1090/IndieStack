# Provider Diagnostics

`pnpm provider:doctor` turns the optional integrations in this template into a single,
credential-free configuration report. It is designed to answer one question before runtime:
**would this deployment silently disable a feature, fall back to another provider, or fail
with a partial setup?**

The doctor reads environment variables locally. It makes no network requests and never prints
credential values, which makes it safe to run in a terminal, a deployment log, or a local
onboarding checklist.

```bash
pnpm provider:doctor
pnpm provider:doctor --json
```

Exit code `0` means there are no blocking configuration problems. Optional providers that are
entirely absent are reported as `off` and do not fail the command. Exit code `1` means at least
one required provider is missing or one provider is partially configured.

## Status Model

| Status | Meaning | Blocks deployment? |
|--------|---------|--------------------|
| `ready` (`ok`) | Minimum runtime configuration is present, or an intentional fallback is active. | No |
| `disabled` (`off`) | None of the provider variables are present and the feature is off. | No for optional providers; Supabase is reported this way only in Mock mode |
| `degraded` (`warn`) | The feature works, but a non-runtime companion configuration is incomplete. | No, but review before release |
| `misconfigured` (`error`) | Some variables are present but the configuration is incomplete. | Yes |
| `missing` (`missing`) | A required provider is absent outside Mock mode. | Yes |

The report also includes `provider=mock`, `provider=supabase`, or `provider=oss` where the
runtime can select an implementation. Partial OSS configuration is always an error because it
means the operator tried to enable OSS but will silently get Supabase Storage instead.

## Covered Providers

| Provider id | Runtime / fallback | Environment keys | Partial or absent behavior |
|-------------|--------------------|------------------|----------------------------|
| `supabase` | Supabase database, Auth, and admin client | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` | Missing runtime keys are blocking outside Mock mode; runtime keys without `SUPABASE_DB_URL` are a warning because migration scripts cannot connect directly |
| `storage` | OSS when complete, otherwise Supabase Storage | `OSS_BUCKET`, `OSS_REGION`, `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET` | No OSS keys means the Supabase fallback; a partial set is `misconfigured` and still falls back to Supabase |
| `email` | Resend HTTP API | `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_API_URL` | No API key disables email; an override such as `RESEND_FROM` without `RESEND_API_KEY` is `misconfigured` |
| `webpush` | Browser Web Push with VAPID | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_APP_URL` | Both VAPID keys are required to enable delivery; one key makes the provider `misconfigured`. `NEXT_PUBLIC_APP_URL` is the VAPID contact subject and defaults to a mailto address |
| `appark` | Appark APM | `NEXT_PUBLIC_APPARK_API_KEY`, `NEXT_PUBLIC_APPARK_ENDPOINT` | Both values are required to enable APM; a partial pair is `misconfigured` and the runtime stays bypassed |
| `stripe` | Stripe Checkout, portal, webhook verification, and prices | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRO_PRICE_ID`, `STRIPE_ENTERPRISE_PRICE_ID` | Billing is off when all keys are absent; any partial set is `misconfigured` because checkout or webhook delivery can fail |
| `sentry` | Sentry runtime errors and source-map upload | `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | Runtime capture with missing build keys is `degraded`; build credentials without a DSN are `misconfigured` |
| `supabase-restore` | Management API route for free-tier auto-restore | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` | Both are required when enabled. `SUPABASE_PROJECT_REF` may be inferred from a standard `<ref>.supabase.co` URL; a token without an inferable ref, or a ref without a token, is `misconfigured` |
| `cron` | Scheduled route authentication | `CRON_SECRET` | Missing `CRON_SECRET` disables scheduled routes safely; set it when Vercel Cron or an external scheduler should call the routes |

## Common Workflows

### Local development with Mock mode

Set `NEXT_PUBLIC_MOCK_ENABLED=true` (or leave Supabase URL unset in a non-production
environment). `provider:doctor` reports Supabase as `off`, storage as the Mock fallback, and
does not fail the command for the missing external services. The existing Mock guide in
[Mock Mode](./mock) explains the in-memory data and request-isolation model.

### Staging or production with Supabase

Provide the three runtime keys and `SUPABASE_DB_URL`. A report showing
`supabase: degraded (SUPABASE_DB_URL)` means the app can serve traffic but `pnpm db:migrate`,
`pnpm db:types`, and other direct database scripts will not work.

### Enabling a provider without surprising fallback

Configure every key for a provider or leave every key absent. The doctor deliberately treats a
partial set as an error instead of guessing the operator's intent. This is especially important
for `storage`: a partial OSS set silently uses Supabase Storage at runtime, but the doctor still
reports `storage: misconfigured`.

### Reading the JSON report

```bash
pnpm provider:doctor --json
```

The JSON shape is stable for automation:

```json
{
  "ok": true,
  "mockMode": false,
  "nodeEnv": "production",
  "providers": [
    {
      "id": "supabase",
      "label": "Supabase core",
      "status": "ready",
      "required": true,
      "configured": true,
      "missing": [],
      "notes": ["Runtime, admin client, and database migration configuration are present."]
    }
  ],
  "problems": [],
  "warnings": []
}
```

The sample is abbreviated; the real report contains every provider. Only variable names appear
in `missing` — never the variable values.

## Troubleshooting Map

| Report line | Action |
|-------------|--------|
| `supabase: missing (...)` | Set the runtime keys, or enable Mock mode for local work. In production this is a deployment blocker. |
| `supabase: degraded (SUPABASE_DB_URL)` | Set `SUPABASE_DB_URL` before running migrations or generating database types. |
| `storage: misconfigured` | Add the remaining OSS keys, or remove all OSS keys to use the documented Supabase fallback. |
| `email: misconfigured` | Remove the Resend override or add `RESEND_API_KEY`. |
| `webpush: misconfigured` | Add the missing VAPID key; both keys must come from the same key pair. |
| `appark: misconfigured` | Add the missing Appark key or remove both Appark variables to keep APM off. |
| `stripe: misconfigured` | Complete all five Stripe values before enabling billing. |
| `sentry: degraded` | Add `SENTRY_ORG`, `SENTRY_PROJECT`, and `SENTRY_AUTH_TOKEN` if source maps should upload; otherwise runtime capture still works. |
| `supabase-restore: misconfigured` | Add both `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF`, or remove both to disable auto-restore. |
| `cron: off` | Set `CRON_SECRET` only in environments where scheduled routes should be callable. |

## Documentation Gate

`pnpm check:provider-docs` validates both the English and Chinese versions of this guide
against the provider registry in `src/lib/providers/diagnostics.ts`. Adding a provider or an
environment key without documenting it in both locales fails the gate. The check is wired into
`pnpm check:all` and the CI `Lint & Type Check` job.
