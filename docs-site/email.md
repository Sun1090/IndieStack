# Email Delivery

IndieStack uses Resend for application email. Supabase Auth email is configured separately through
the Supabase project, so account emails and product notifications have different operational
boundaries.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `RESEND_API_KEY` | For application email | Server-only Resend API key |
| `RESEND_FROM` | Recommended | Verified sender, for example `IndieStack <hello@example.com>` |
| `RESEND_API_URL` | No | Test-only endpoint override used by the E2E mail capture server |
| `CRON_SECRET` | For digest | Authenticates `POST /api/cron/digest` through the `x-cron-secret` header |

```bash
RESEND_API_KEY=re_xxxxxxxxx
RESEND_FROM="IndieStack <hello@example.com>"
CRON_SECRET=replace-with-a-random-secret
```

Never expose `RESEND_API_KEY` or `CRON_SECRET` through a `NEXT_PUBLIC_` variable.

## Notification Delivery

When `notifyUser()` creates an in-app notification, only these high-priority types attempt an
immediate email:

- `security_alert`
- `team_invite`
- `role_changed`
- `payment_succeeded`

Immediate delivery respects `shouldSendEmail()`. A successful send records the notification as
sent; a failure leaves it queued for the digest worker. Other notification types remain in-app
only in the current implementation.

## Digest Worker

`POST /api/cron/digest` processes up to 100 queued notifications per run. It groups them by user,
applies that user's email preferences, and sends one digest per user. Immediate-send failures and
items left in the queue are retried by this worker.

The worker can fold large groups and caps the visible digest details, keeping the message size
bounded. It also emits backlog and worker metrics for operational monitoring.

Digest delivery is **one email per run, per user, with something queued**. It deliberately does not
try to hit each user's local morning: on the Hobby plan a cron path can run at most once a day, so a
single fixed UTC instant (`0 9 * * *`) can only fall inside one timezone's morning — before 2026-09-22
this route gated on "the user's local hour is exactly 08:00", which meant notifications stayed queued
forever for everyone outside the UTC-1 band. `vercel.json` registers the schedule and
`pnpm check:cron-contract` keeps the registry, the platform schedule and
`docs/operations/sentry-alerts.md` in sync.

If a user's local-morning delivery matters again, that needs a second cron path (or an external
hourly scheduler) rather than a looser gate; the trade-off is recorded in `docs/roadmap-0.12.0.md`.

## Preferences and Retries

The email preference matrix applies to both immediate sends and digest delivery. The global
`emailNotifications` switch disables product email; `securityAlerts` and `productUpdates` provide
type-level control.

Each failed send increments `metadata.email_attempts` and records `metadata.email_error`. Once the
attempt count reaches 3, the notification becomes a dead letter and is excluded from further
digest pulls. Operators can query dead letters through the notification repository API.

## Marketing Email

Marketing mail is a separate double opt-in channel and does not use the `notifications` table:

- Subscription confirmation and unsubscribe operations only accept `POST`.
- Tokens are stored as SHA-256 digests and expire after 7 days.
- Every marketing message includes a recipient-specific unsubscribe link.

## Supabase Auth Email

Account verification, invitations, magic links, and password resets are sent by Supabase Auth, not
Resend. Manage the templates and redirect allowlist with:

```bash
pnpm auth:email-config
pnpm auth:email-config -- --apply
pnpm auth:email-config -- --verify --scope=templates
```

The command defaults to a dry run. On the current free-tier setup, Supabase uses the default sender
and allows only 2 Auth emails per hour for the entire project. Configure custom SMTP before relying
on production signup volume or trying to update templates.

## Verification

```bash
pnpm test -- src/lib/email-send.test.ts src/lib/email-notify.test.ts
pnpm test -- src/app/api/cron/digest/route.test.ts
pnpm test:e2e -- e2e/mail-flow.spec.ts
pnpm auth:email-config
```
