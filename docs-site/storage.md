# File Storage

IndieStack serves avatars and project covers through one provider-neutral storage contract. The
default provider is Supabase Storage; a complete Alibaba Cloud OSS configuration switches the
driver without changing upload or domain code.

## Provider Selection

| Provider | Default | Required configuration |
| --- | --- | --- |
| Supabase Storage | Yes | Supabase project credentials and the public `avatars` bucket |
| Alibaba Cloud OSS | No | `OSS_BUCKET`, `OSS_REGION`, `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET` |

```bash
# Optional OSS override. All four values must be present.
OSS_BUCKET=your-bucket-name
OSS_REGION=oss-cn-hangzhou
OSS_ACCESS_KEY_ID=your-access-key-id
OSS_ACCESS_KEY_SECRET=your-access-key-secret
```

If all four OSS values are present, the OSS driver is selected. If none or only some are present,
the app uses Supabase Storage. A partial configuration emits an environment warning and a
deduplicated `provider.fallback` metric; credentials are never included in diagnostics.

`provider.fallback` (`provider`, `reason`, `missing`) fires at most once per process for a given
missing-variable signature, so a single misconfiguration cannot become traffic-level noise. The
signature is the alphabetically sorted list of missing variable names, which means it does not
depend on how the configuration is written; changing the missing set re-emits, restoring a complete
configuration resets the state, and an entirely unset OSS configuration is the default driver rather
than a fallback and never alerts.

## Upload Flow

Avatar and project-cover uploads use the same server-side pipeline:

1. Authenticate the caller and enforce resource ownership or team role.
2. Accept only PNG, JPEG, or WebP, with a maximum file size of 2 MB.
3. Verify both the declared MIME type and the file signature.
4. Generate the object key from trusted values, never from the uploaded filename.
5. Upload through the selected storage driver and then write the public URL to the database.
6. If the metadata write fails, best-effort delete the newly uploaded object.
7. When replacing a managed object, delete the old object only after validating its prefix and
   tenant boundary.

The object key format is:

```text
{prefix}/{tenant}/{timestamp}-{random}.{ext}
```

`prefix` is `avatars` or `covers`, and `tenant` is the user ID or project ID. The extension comes
from the MIME allowlist, not from the client filename.

## Browser Endpoints

The profile and project forms use same-origin XHR endpoints so users get upload progress and can
cancel an in-flight request:

| Endpoint | Resource | Authorization |
| --- | --- | --- |
| `POST /api/uploads/avatar` | Current user's avatar | Authenticated user |
| `POST /api/uploads/project-cover` | Project cover | Team owner or admin |

All upload rules — authentication, the MIME allowlist, the size limit, the database write-back and
orphan cleanup — live in `src/lib/uploads/service.ts`. The three request-boundary guards
(same-origin, rate limit, request body cap applied before multipart parsing) live in
`src/lib/uploads/request.ts` and apply **only to these two routes**: a non-browser caller that
imports the service functions directly gets none of them and has to supply its own.

## Supabase Bucket

Migration `024_storage_avatars_policies.sql` creates or updates the public-read `avatars` bucket and
its storage policies. Authenticated users can write only under their own top-level folder. The app
uses the service role for server-side reads, writes, signed URLs, and cleanup.

The bucket remains public because profile and project image URLs are embedded directly in rendered
pages. Do not store private documents in this bucket.

## OSS Behavior

The OSS driver uses the same public-read bucket model and implements `put`, `signedUrl`, and
`remove` through `ali-oss`. Signed URL expiry must be an integer between 1 second and 7 days for
both providers.

## Upload Metrics

Two metrics cover uploads, and they answer different questions:

- `storage.upload.completed` (`provider`, `outcome`) fires once per provider object write. Use it to
  check OSS or Supabase health.
- `upload.request.completed` (`operation`, `outcome`) fires once per upload request and spans the
  whole chain: provider write, metadata write-back, and rollback. This is the metric that reflects
  what the user actually got.

`outcome` is `success`, `failure`, or `cancelled` for the request metric; a user cancelling an
upload must not count as a storage failure. Values above 5% `failure` on the provider metric, or
above 10% on the request metric, indicate a problem worth investigating.

Both metric names and their attribute values come from `src/lib/observability/storage-metrics.ts`;
the fallback metric and its deduplication gate come from
`src/lib/observability/provider-metrics.ts`. Do not hand-write the literals at call sites.

Cleanup failures are logged without failing a database write that already succeeded, because the
database remains the source of truth.

## Limits and Recovery

- The current implementation buffers through the server and does not provide direct signed uploads.
- There is no provider-neutral list or automatic orphan-scan API yet.
- Before adding bulk cleanup, implement a restricted list contract, a dry-run report, and tenant
  audit logging. Never bulk-delete objects from arbitrary URLs or user input.
- Cleanup is best effort. Failed cleanup is structured for later repair rather than silently
  reported as success.

## Verification

```bash
pnpm test -- src/lib/storage/index.test.ts src/lib/uploads
pnpm test -- src/lib/observability/storage-metrics.test.ts
pnpm test -- src/lib/observability/provider-metrics.test.ts
pnpm test -- src/app/api/uploads
pnpm test:e2e -- e2e/uploads.spec.ts
```

