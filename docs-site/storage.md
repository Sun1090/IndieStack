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

Both routes reject cross-origin requests, enforce rate limits and body limits, and reuse the same
service layer as the server actions.

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

OSS and Supabase uploads emit `storage.upload.completed` with `provider` and `outcome` attributes.
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
pnpm test -- src/app/api/uploads
pnpm test:e2e -- e2e/uploads.spec.ts
```

