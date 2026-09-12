# Web Push

IndieStack sends browser notifications through the Web Push protocol. Subscriptions are persisted in
Supabase, while server-side delivery uses the `web-push` adapter and VAPID credentials.

## Configuration

| Variable                       | Required    | Purpose                                                               |
| ------------------------------ | ----------- | --------------------------------------------------------------------- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Yes         | Public application-server key used by the browser                     |
| `VAPID_PRIVATE_KEY`            | Yes         | Server-only signing key; never expose it with a `NEXT_PUBLIC_` prefix |
| `NEXT_PUBLIC_APP_URL`          | Recommended | VAPID contact subject; production must use HTTPS                      |

Generate a key pair once and store it in the deployment environment:

```bash
pnpm exec web-push generate-vapid-keys

NEXT_PUBLIC_VAPID_PUBLIC_KEY=your-public-key
VAPID_PRIVATE_KEY=your-private-key
NEXT_PUBLIC_APP_URL=https://app.example.com
```

If `NEXT_PUBLIC_APP_URL` is not HTTPS, the adapter uses `mailto:support@indiestack.dev` as the
VAPID subject. Missing public or private keys disable the provider; the settings page shows an
explicit "not configured" state instead of pretending delivery succeeded.

Production also needs HTTPS because browsers only expose service workers and PushManager in a
secure context (localhost is the development exception).

## Subscription Flow

1. The user enables **Browser notifications** in `/dashboard/settings`.
2. The browser registers `/sw.js` and creates a Push API subscription.
3. The endpoint and `p256dh`/`auth` keys are stored in `public.push_subscriptions`.
4. `user_id + endpoint` is unique, so repeated registration is idempotent.
5. Disabling notifications revokes the database record and the browser subscription.
6. The settings form detects an existing browser subscription after a page reload.

Migration `020_push_subscriptions.sql` creates the table, RLS policies, endpoint index, and
`updated_at` trigger.

Migration `026_push_delivery_attempts.sql` adds the per-endpoint retry and dead-letter table. It is
server-only: RLS is enabled with no anon/authenticated policies, and the cron worker uses the
service-role client.

## Delivery Contract

`notifyUser()` writes the in-app notification first, then attempts Web Push for every active
subscription. The service worker accepts this JSON payload:

```json
{
  "title": "Security alert",
  "body": "Review your session",
  "url": "/dashboard/settings",
  "tag": "event-idempotency-key"
}
```

Delivery uses a 1-hour TTL, a 10-second transport timeout, high urgency, and VAPID authentication.
It fans out to all subscriptions owned by the user.

Each `(notification_id, endpoint)` pair is persisted before the first transport call. The
in-app notification remains the source of truth. Web Push itself is at-least-once delivery, so a
lost success receipt can cause a duplicate push; the service-worker `tag` keeps notification
display idempotent where the browser supports it.

Push follows the same preference matrix as email and additionally honors `pushNotifications`.
Set `pushNotifications: false` to disable all browser push without affecting in-app notifications.

## Retry and Dead-Letter Queue

- Transient failures remain `pending` and are retried with exponential backoff (`60s × 2^(n-1)`,
  capped at 1 hour). With the current three-attempt maximum, the actual waits are 60 seconds and
  2 minutes.
- A delivery is attempted at most 3 times including the immediate send. The third failure becomes a
  `dead` row with `failure_code=max-attempts` and is no longer pulled by the worker.
- The worker processes up to 50 due rows per invocation. `/api/cron/push-retry` is scheduled every
  15 minutes in `vercel.json` and requires the same `CRON_SECRET` as `/api/cron/digest`.
- A missing subscription row, a browser that disabled push in the meantime, or a notification row
  that no longer exists moves the attempt to the dead-letter queue without another transport call.
- Dead letters are retained for operator inspection through
  `listDeadLetterPushDeliveries()`, `countDeadLetterPushDeliveries()`, and
  `countInvalidPushEndpoints()` in `src/lib/repositories/push-delivery-attempts.ts`.
- Terminal rows are pruned after a bounded retention window: `sent` for 7 days and `dead` for 30 days,
  up to 1,000 rows per status on each cron run. `pending` rows are never pruned, so delayed work cannot
  be lost. The route reports the deleted counts as `pruned: { sent, dead }`; cleanup is best-effort and
  a failure returns `pruned: null` without changing the delivery result.

## Failure and Cleanup Behavior

- HTTP `404` or `410` means the browser endpoint is permanently gone; IndieStack deletes that
  subscription immediately and records a `subscription-gone` dead letter.
- Other transient failures are logged, queued, and do not block the in-app notification or the
  email channel.
- Metrics: `push.send.completed` includes a `status_code`; `push.send.failed` includes a reason such
  as `not-configured`, `subscription-gone`, `timeout`, or `http-*`. `push.endpoint.revoked` and
  `push.delivery.dead` classify cleanup and dead-letter reasons. `push.backlog` reports pending
  rows, `push.queue.pruned` reports terminal-row cleanup by `status` and `retention_days`,
  `push.queue.prune_failed` reports cleanup failures, and `cron.push-retry.completed` /
  `cron.push-retry.failed` report worker health.

## Verification

```bash
pnpm test -- src/lib/push-provider.test.ts src/lib/push-notify.test.ts
pnpm test -- src/lib/push-retry.test.ts src/lib/repositories/push-delivery-attempts.test.ts
pnpm test -- src/lib/repositories/push-subscriptions.test.ts src/lib/email-notify.test.ts
pnpm test -- src/components/forms/push-notification-form.test.tsx
pnpm type-check
```

A real browser push requires VAPID credentials, HTTPS, a push-capable browser, and the provider
service. That end-to-end path remains an external deployment check rather than a local unit test.
