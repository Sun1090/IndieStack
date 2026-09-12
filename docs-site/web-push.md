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

Push follows the same preference matrix as email and additionally honors `pushNotifications`.
Set `pushNotifications: false` to disable all browser push without affecting in-app notifications.

## Failure and Cleanup Behavior

- HTTP `404` or `410` means the browser endpoint is permanently gone; IndieStack deletes that
  subscription immediately.
- Other failures are logged and do not block the in-app notification or the email channel.
- Metrics: `push.send.completed` includes a `status_code`; `push.send.failed` includes a reason such
  as `not-configured`, `subscription-gone`, `timeout`, or `http-*`.
- Push currently has no durable retry queue or dead-letter table. Transient delivery is best-effort;
  the in-app notification remains the source of truth.

## Verification

```bash
pnpm test -- src/lib/push-provider.test.ts src/lib/push-notify.test.ts
pnpm test -- src/lib/repositories/push-subscriptions.test.ts src/lib/email-notify.test.ts
pnpm test -- src/components/forms/push-notification-form.test.tsx
pnpm type-check
```

A real browser push requires VAPID credentials, HTTPS, a push-capable browser, and the provider
service. That end-to-end path remains an external deployment check rather than a local unit test.
