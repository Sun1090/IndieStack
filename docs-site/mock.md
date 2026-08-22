
# Mock Mode Development Guide

## Overview

IndieStack includes a complete Mock system built on `@faker-js/faker` for generating realistic test data. With Mock mode enabled, you can do full local development and debugging without a real Supabase backend.

### Why Mock Mode

- **Offline Development**: Keep working without network or Supabase access
- **Quick Start**: Skip database setup, start dev server in seconds
- **Frontend-First**: Focus on UI development first, connect backend when ready
- **API Simulation**: Combine with Apifox for complete API mocking
- **Test-Friendly**: Deterministic data generation for reliable tests

## Enabling Mock Mode

### Method 1: Environment Variable (Recommended)

Set in `.env.local`:

```bash
# Development Mock Mode
NEXT_PUBLIC_MOCK_ENABLED=true
```

### Method 2: Automatic Enable

Mock mode activates automatically when `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` is not set.

### Method 3: CLI Scripts

```bash
# Start with Mock mode
pnpm dev:mock

# Start with Supabase
pnpm dev:supabase
```

## Mock Data Generation

Mock data is powered by `@faker-js/faker`, defined in `src/lib/mock/data.ts`:

| Data Type | Generator | Description |
|-----------|-----------|-------------|
| User | `generateMockUser()` | ID, email, avatar |
| Session | `generateMockSession()` | Simulates Supabase session |
| Profile | `generateMockProfile()` | Name, bio, avatar |
| Team | `generateMockTeam()` | Team name, description |
| Team Members | `generateMockTeamMembersWithProfiles()` | Roles, statuses |
| Projects | `generateMockProjects()` | Name, status, progress |
| Notifications | `generateMockNotifications()` | Title, content, type |
| Audit Logs | `generateMockAuditLogs()` | Actions, IP, timestamp |
| API Usage | `generateMockApiUsage()` | Request count, error rate |
| Subscription | `generateMockSubscription()` | Plan, status, renewal |

### Caching Strategy

Mock data is **cached per request** for consistency. Each request generates fresh random data. Call `resetMockCache()` to manually refresh.

## Mock Supabase Client

The system implements a `MockSupabaseClient` class that simulates the core Supabase API:

### Supported APIs

```typescript
// Auth API
const { data: { user } } = await supabase.auth.getUser()
const { data: { session } } = await supabase.auth.getSession()
const { data } = await supabase.auth.signUp({ email, password })
const { data } = await supabase.auth.signInWithPassword({ email, password })
const { data } = await supabase.auth.signInWithOAuth({ provider: "github" })
await supabase.auth.signOut()
await supabase.auth.resetPasswordForEmail({ email })
await supabase.auth.updateUser({ ... })

// Database Query (Chained)
const { data } = await supabase
  .from("profiles")
  .select("*")
  .eq("id", userId)
  .single()

const { data } = await supabase
  .from("team_members")
  .select("*")
  .order("created_at", { ascending: false })
  .limit(10)

// Insert / Update / Delete
await supabase.from("profiles").insert({ ... })
await supabase.from("profiles").update({ ... }).eq("id", userId)
await supabase.from("profiles").delete().eq("id", userId)
```

### Supported Tables

| Table | Returns |
|-------|---------|
| `profiles` | 10 random profiles |
| `teams` | 1 team |
| `team_members` | Team members |
| `notifications` | Notification list |
| `audit_logs` | Audit log entries |
| `subscriptions` | Subscription info |

## Apifox Integration

Apifox enhances your API and Mock workflow alongside the built-in system:

### Why Apifox

- **Auto-Generated API Docs**: Import from code comments or OpenAPI specs
- **Mock Data Management**: Custom mock rules
- **API Debugging**: Visual request/response inspection
- **Team Collaboration**: Share API documentation

### Setup Steps

1. **Export OpenAPI Spec**

   Install the Apifox CLI:

   ```bash
   pnpm install -g apifox-cli
   ```

2. **Create Apifox Project**

   - New project, choose "Import"
   - Select "OpenAPI / Swagger" format
   - Upload or paste the API spec

3. **Configure Environments**

   - Development: `http://localhost:3000`
   - Production: `https://your-app.vercel.app`

4. **Enable Apifox Mock**

   - Turn on "Cloud Mock" in Apifox
   - Configure mock rules: field types, length, format
   - Use Apifox Mock URL for debugging

5. **Custom Mock Rule Example**

   ```json
   {
     "code": 0,
     "message": "success",
     "data": {
       "id": "@integer(1, 10000)",
       "name": "@cname",
       "email": "@email",
       "avatar": "@image(200x200)",
       "createdAt": "@datetime"
     }
   }
   ```

### Working Together

- Built-in Mock is ideal for **frontend development** — zero config
- Apifox Mock excels at **API integration** — fine-grained response control
- Combine both: use built-in Mock for rapid UI iteration, then Apifox Mock for API verification

## Limitations

### Feature Gaps

Mock mode does **not** support these real backend features:

| Feature | Description | Alternative |
|---------|-------------|-------------|
| Real Auth | No email/SMS sending | Auto-login success |
| Realtime | No WebSocket connection | Static data |
| File Storage | No Alibaba Cloud OSS | Local placeholders |
| Stripe Payments | No real payment processing | Mock success response |
| Permission Check | All users default admin | Local validation |
| Data Persistence | No persisted storage | In-memory cache |

### Source Code

```
src/lib/mock/
  index.ts   # Mock entry, client, query builder
  data.ts    # Data generators (powered by @faker-js/faker)
```

### Development Tips

1. **New Features**: Start with Mock mode for rapid UI iteration
2. **API Integration**: Switch to real Supabase to verify API logic
3. **Automated Tests**: Mock mode works well in CI for frontend tests
4. **Team Collaboration**: Use Apifox for shared API documentation
