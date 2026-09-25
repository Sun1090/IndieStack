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

The queue predicate is `email_sent = false` **and** `is_read = false`, so reading a notification in
app — one at a time or via "mark all read" — also takes it out of the email queue: mail for
something the user already saw is never sent, and that row stops counting toward `email.backlog`.
A send that succeeded while its receipt write failed is reported as its own event, not as a send
failure: the message did leave, and the next digest run may send it again.

## Digest Worker

`POST /api/cron/digest` processes up to 100 queued notifications per run. It groups them by user,
applies that user's email preferences, and sends one digest per user. Immediate-send failures and
items left in the queue are retried by this worker.

The worker can fold large groups and caps the visible digest details, keeping the message size
bounded. For operational monitoring it emits backlog and run metrics, plus
`cron.digest.skipped{reason}` whenever a run skips items it cannot deliver (`no_email` — the profile
has no address; `preference` — the user switched those types off). Skipping is never silent:
`pnpm check:cron-contract` statically fails a worker route whose conditional skip has no counter.

Skipping is also how a row leaves the queue now (A05): the same branch writes
`notifications.email_skipped_reason` for the ids it is giving up on, so those rows stop occupying the
`created_at`-ascending head of the pull window. A reason is not a delivery attempt and not a send —
those rows never get `email_sent`, and their retry counter stays where it was, because "this user has
no address" is not a failure that a retry can fix. The consequence is stated in the schema and here,
not in code comments only: if that user later adds an email address or switches the types back on,
the already-skipped notifications are **not** resurrected — they stay in the app and the next
notification is delivered normally. The allowed reasons are one list in
`src/lib/notifications/types#EMAIL_SKIP_REASONS` and one `CHECK` in
`supabase/migrations/034_email_skip_reason.sql`; a test reads the migration and compares them, so the
drift shows up as a rejected write in production or a red test here, never as a silently wider column.

Receipt writes are separated from delivery in the other direction too: a group counts as sent the
moment the provider accepts it, and a receipt write that then fails is reported on its own
(`cron.digest.receipt_failed{stage="sent"}`) instead of aborting the run — the row stays queued, so a
later run may send that user a second digest. The mirror case (`stage="retry"`) is a send that failed
*and* whose `email_attempts` increment could not be written: the group still counts as failed, but the
retry counter did not move, and nothing on the email side bounds it — unlike Web Push there is no
row-age ceiling, because dropping a queued email after N days changes delivery semantics and that
belongs to the A05 semantics described above. A third stage, `stage="skip"`, is the dequeue write
itself failing: the metric still counts that group as skipped and the run completes, but those rows
stayed in the queue, so the next run pulls them again. None of these receipt cases may erase the round's own record any more: a run that
dies mid-way logs `pulled` / `sent` / `groups` / `failed` exactly as they stood, because the panel's
"empty send round" reading is defined as `pulled > 0 && sent === 0 && failed === 0`, and a round that
had already delivered mail must never appear there.

The admin overview panel shows the queue itself: how many notifications are pending, how long the
oldest one has been waiting (past 48 h — two daily cycles — it reads as stuck), and how many recent
runs pulled items yet sent none. All of those go through exactly the filter the worker pulls with, so
the age on the panel describes that same queue. On top of them the panel breaks out the two populations that
already left it: rows dequeued by the worker, counted per `email_skipped_reason`, and rows taken out
because they were read in the app first (the queue predicate includes `is_read = false`, so those stop
counting toward `email.backlog` — the backlog number alone would read a jam as a shrink). Neither
figure changes what gets sent; they say which rows are gone and why.

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
