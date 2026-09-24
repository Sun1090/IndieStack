# Mock Mode Development Guide

## Overview

IndieStack ships a built-in Mock backend so you can run the full app locally without a
Supabase project. Mock mode is implemented in `src/lib/mock/` and keeps the same
call shapes the real client uses, so feature code does not branch on "am I mocked?".

### When to use Mock mode

| Use it for | Do not use it for |
| ---------- | ----------------- |
| UI work without network or Supabase | Verifying RLS, policies or tenant isolation |
| Playwright E2E and unit tests | Verifying real auth, email delivery or OAuth |
| Demos and onboarding (zero config) | Verifying Stripe, storage or Edge Function behaviour |

Mock mode must never be treated as evidence that a security boundary works. Real
boundaries are covered by the database identity matrix instead (see `docs/testing.md`).

## Enabling Mock mode

Mock mode is enabled by a single runtime check in `src/lib/mock/config.ts`.

### 1. Explicit flag (recommended)

```bash
# .env.local
NEXT_PUBLIC_MOCK_ENABLED=true
```

### 2. Automatic fallback (non-production only)

If `NEXT_PUBLIC_MOCK_ENABLED` is unset, Mock mode still activates when **all** of the
following hold:

- `NODE_ENV` is **not** `"production"`, and
- `NEXT_PUBLIC_SUPABASE_URL` is missing.

`NEXT_PUBLIC_SUPABASE_ANON_KEY` is irrelevant to this decision. Production builds never
fall back automatically: a production deploy with a missing Supabase URL fails loudly
instead of silently serving mock users.

### 3. CLI scripts

```bash
pnpm dev:mock       # NEXT_PUBLIC_MOCK_ENABLED=true pnpm dev
pnpm dev:supabase   # bash scripts/dev.sh start (local Supabase stack)
```

### Detecting Mock mode in code

```typescript
import { isMockEnabled, shouldUseMock } from "@/lib/mock/config";

if (shouldUseMock()) {
  // route handlers, seeds and test helpers
}
```

`src/lib/mock/config.ts` is intentionally dependency-free (no `@faker-js/faker`) so
`src/proxy.ts` can import it without pulling fixture generators into the request path.

## Supported tables

`MockSupabaseClient` answers `from(table)` from an in-memory dataset. The table set below
is the exact list accepted by the client's `switch (this.table)` branches; anything else
returns an empty result (reads) or a no-op (writes).

| Table | Kind | Notes |
| ----- | ---- | ----- |
| `profiles` | seeded, writable | Profile of the mock user, role `super_admin` |
| `teams` | seeded, writable | One deterministic team (`MOCK_TEAM_ID`) |
| `team_members` | seeded, writable | Roles resolved through `applyRelationships()` |
| `team_members_with_profiles` | seeded, read-only | Joined view used by member lists |
| `subscriptions` | constant, read-only | Always `pro / active` for the mock team |
| `notifications` | seeded, writable | Drives the realtime bridge below |
| `audit_logs` | seeded, writable | |
| `projects` | seeded, writable | |
| `api_usage` | seeded, writable | |
| `api_keys` | seeded, writable | |
| `user_sessions` | seeded, writable | |
| `email_worker_runs` | seeded, writable | Read by `/api/e2e/email-worker-runs` |
| `marketing_subscriptions` | seeded, writable | |
| `contact_messages` | seeded, writable | Contact form loop |
| `webhook_events` | seeded, writable | Stripe idempotency loop |
| `push_delivery_attempts` | seeded, writable | Push retry loop |
| `push_subscriptions` | seeded, writable | |
| `upload_objects` | seeded, writable | Storage metadata loop |

### Query builder behaviour

| Feature | Behaviour |
| ------- | --------- |
| `select()` | Filters, `order()`, `limit()`/`range()` and `single()`/`maybeSingle()` are applied locally |
| `eq()` / `neq()` / `in()` / `is()` | Supported filters |
| `insert()` / `update()` / `delete()` | Mutate the cached list in place so later reads see the write |
| `rpc()` | Implements `claim_webhook_event`, `erase_user_data`, `list_user_objects_for_erasure` and `find_orphan_upload_objects`; other names return `null` data |
| Unknown table | Reads resolve `[]`, writes resolve without persisting |

Auth surface: `getUser`, `getSession`, `signInWithPassword`, `signUp`,
`signInWithOAuth`, `signOut`, `resetPasswordForEmail`, `updateUser`, plus the MFA surface
(`enroll`, `challenge`, `challengeAndVerify`, `verify`, `unenroll`) all return deterministic
mock results, with stateful MFA transitions backed by the shared cache.

## State model and isolation

The Mock client keeps its dataset in a **process-wide** cache, not a per-request one:

- Module-level caches are mirrored into `globalThis.__indiestackMockCache__`. The
  `globalThis` hop exists because Next.js dev and production builds both split the mock
  module into several chunks; without it, an RSC/route-handler write would be invisible to
  a later server-action read (this was a real v0.5.0 bug).
- Call `resetMockCache()` to clear every cached list, the mock user/session and MFA state.
- Because the cache is process-wide, two concurrent browsers hitting the same dev server
  share mutations. Keep E2E specs serial (Playwright defaults to a single worker).

When you need per-request isolation instead — parallel specs, concurrent scenario tests,
adapter unit tests — create a scoped store and pass it in:

```typescript
import { createMockRequestStore, createMockSupabaseClient } from "@/lib/mock";

const store = createMockRequestStore();
const supabase = createMockSupabaseClient({ store });
```

`createMockRequestStore()` returns `get` / `set` / `getOrCreate` / `clear` over a private
`Map`, so nothing leaks between requests. File-backed fixtures are deliberately **not**
used as a runtime database; see `docs/testing.md` for the F02/F03 rationale.

### Resetting a running dev server

`POST /api/e2e/mock-reset` clears the process-wide cache without restarting the server.
It is mock-only (404 otherwise) and requires `Authorization: Bearer <E2E_BEARER_TOKEN>`:

```bash
curl -X POST http://localhost:3000/api/e2e/mock-reset \
  -H "Authorization: Bearer $E2E_BEARER_TOKEN"
# → { "ok": true, "reset": true }
```

## How Mock mode plugs into the app

| Integration point | Mock behaviour |
| ----------------- | -------------- |
| `src/proxy.ts` | Still generates the CSP nonce, `x-request-id` and runs `updateSession()`, then returns early before route-level redirects |
| Page-level guards | `requireRole()` / `requirePermission()` still run — Mock mode only skips the proxy's redirect layer |
| Supabase server client | Returns `MockSupabaseClient` |
| Supabase browser client | Returns `MockSupabaseClient` |
| Realtime | Server-side seeds dispatch the `indiestack:mock-realtime` DOM event consumed by the client subscription |
| Storage | Local placeholder URLs; `/api/e2e/mock-upload` injects `put()` failures |
| Push transport | `src/lib/mock/push-transport.ts` replaces only the `web-push` HTTP transport; config checks, payload building, retry and error mapping stay real |
| Admin client | Never mocked — service-role code paths must be exercised against a real database |

## E2E-only endpoints

`src/app/api/e2e/` contains Mock-mode-only helpers. Every route returns 404 outside Mock
mode and requires `Authorization: Bearer <E2E_BEARER_TOKEN>` unless noted.

| Endpoint | Methods | Purpose |
| -------- | ------- | ------- |
| `/api/e2e/mock-reset` | POST | Clear the process-wide Mock cache |
| `/api/e2e/seed-notifications` | GET, POST | Seed notification rows and dispatch realtime events |
| `/api/e2e/push-queue` | GET, POST | Seed push subscriptions/attempts and inspect the retry queue |
| `/api/e2e/mock-upload` | GET, POST | Read/set `failNext` so mock `storage.from(bucket).upload()` fails deterministically |
| `/api/e2e/email-inbox` | GET, POST, DELETE | Captured outbound email (`RESEND_API_URL` points here) |
| `/api/e2e/email-worker-runs` | GET | Inspect worker run rows written by cron handlers |
| `/api/e2e/webhook-events` | GET, DELETE | Inspect/clear claimed webhook events |
| `/api/e2e/contact-messages` | GET, POST, DELETE | Inspect/clear contact-form submissions |

Reserved push endpoints use `E2E_PUSH_ENDPOINT_BASE`:

| Endpoint | Scenario |
| -------- | -------- |
| `E2E_PUSH_ENDPOINTS.ok` | Delivered (201) |
| `E2E_PUSH_ENDPOINTS.transient` | Network error, retried until dead-letter |
| `E2E_PUSH_ENDPOINTS.timeout` | Timeout, `failure_code=timeout` |
| `E2E_PUSH_ENDPOINTS.gone` | 410, local subscription revoked |

Any other push endpoint throws, so a forgotten fixture fails instead of looking delivered.

## Playwright wiring

`playwright.config.ts` starts `pnpm dev -p 3100` and injects the environment Mock mode
needs:

| Variable | Value | Why |
| -------- | ----- | --- |
| `NEXT_PUBLIC_MOCK_ENABLED` | `true` | Turn Mock mode on |
| `E2E_BEARER_TOKEN` | `e2e-bearer-token` | Guard the `/api/e2e/*` endpoints above |
| `RESEND_API_URL` | `http://localhost:3100/api/e2e/email-inbox` | Capture outbound email locally |
| `CRON_SECRET` | `e2e-cron-secret` | Authenticate cron route calls |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | `sk_test_e2e_webhook` / `whsec_e2e_webhook` | Drive the webhook idempotency loop |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | placeholders | `web-push` config checks pass; signing is replaced by the mock transport |

The web server is shared mutable state, so `workers` defaults to `1`. Only the isolation
experiment sets `PW_FULLY_PARALLEL=true`.

That experiment is no longer a one-off: the `E2E parallel baseline` workflow runs the **whole**
suite (deliberately without `--shard`) with `PW_FULLY_PARALLEL=true`, on demand and every Monday at
`30 7 * * 1` (07:30 UTC). It opens **one dev server per worker** (`E2E_SERVERS=3`; the config sets
`workers` to the same number), because the first run of this baseline — several workers against a
single server — measured 4 failing specs whose only common cause was the shared default store.
Each of those servers gets its own `NEXT_DIST_DIR`: Next refuses a second `next dev` for one working
copy, since `<distDir>/dev/lock` is how it decides "this repo already has a dev server". Every spec
addresses the app through `appUrl()`, which picks the port from the worker index.
It forces `--retries=0`: CI defaults to two
retries, and a retry gets a new worker index, i.e. a clean server, so "succeeded the second time"
would no longer describe the same state at all.
It is a measurement, not a merge gate —
a red run means "the parallel baseline has a shared-state conflict, record which state from the
report", not "this PR may not merge". The regular CI shards each get their own dev server and stay
single-worker inside, so they cannot surface those conflicts; the two setups are complementary.
Do not "fix" a red baseline by making the runtime mock store request-scoped: the default store is a
deliberately shared fake database, see `docs/architecture/13-mock-system.md`.

## Limitations

| Feature | Mock behaviour | Real alternative |
| ------- | -------------- | ---------------- |
| Authentication | No email, OAuth or MFA round-trip; mock session returned | Run local Supabase |
| Row Level Security | Not enforced | `pnpm smoke:supabase-identity` |
| Realtime | `indiestack:mock-realtime` DOM event, no WebSocket | Local Supabase + real channel |
| File storage | Placeholder URLs; optional injected failures | Local Supabase Storage or OSS config |
| Payments | Stripe SDK calls are not sent | Stripe CLI in test mode |
| Push notifications | Transport replaced in-process | Not covered locally; see `docs/operations/` |
| Persistence | In-memory only, lost on restart | Local Supabase |
| Data quality | Randomized by `@faker-js/faker`, but IDs/timestamps are deterministic where specs depend on them | Seeds in `supabase/seed.sql` |

The project does not ship an OpenAPI export or an external Mock-tool integration; the
built-in Mock client and the `/api/e2e/*` endpoints above are the supported path.

## Exiting Mock mode

```bash
# .env.local
NEXT_PUBLIC_MOCK_ENABLED=false
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Restart the dev server. Use `pnpm dev:supabase` if you want a fully local Supabase stack.

## Source layout

```
src/lib/mock/
  config.ts          # dependency-free enable check (safe for proxy)
  data.ts            # @faker-js/faker generators + deterministic IDs
  index.ts           # MockSupabaseClient, cache, reset, realtime bridge, upload injection
  store.ts           # createMockRequestStore() request-scoped primitive
  push-transport.ts  # web-push transport replacement for E2E
src/app/api/e2e/     # mock-gated test endpoints
```

`docs/architecture/13-mock-system.md` covers the same contract in Chinese, and
`pnpm check:mock-docs` fails the build when any of these documents drift from the code.
