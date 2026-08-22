 # Supabase Integration
 
 IndieStack deeply integrates Supabase for authentication, database, and real-time backend services.
 
 ## Client Types
 
 | Client | File | Usage | Feature |
 |--------|------|-------|---------|
 | Server Client | `src/lib/supabase/server.ts` | Server Components, Route Handlers, Server Actions | Cookie-based session, auto token refresh |
 | Browser Client | `src/lib/supabase/client.ts` | Client Components | Browser-side queries, auto session cookie |
 | Admin Client | `src/lib/supabase/admin.ts` | Server privileged operations | Service Role Key, bypass RLS |
 | Middleware | `src/lib/supabase/middleware.ts` | Next.js Middleware | Request-level session refresh |
 
 ## Database Tables
 
 ### profiles
 
 Auto-created via database trigger when a user registers in Supabase Auth:
 
 ```sql
 id         UUID PRIMARY KEY → auth.users(id)
 email      TEXT
 full_name  TEXT
 avatar_url TEXT
 role       TEXT → 'user' | 'admin'
 ```
 
 ### teams (Multi-tenant)
 
 Multi-tenant architecture supporting team-based access:
 - **owner**: Full permissions
 - **admin**: Team management
 - **member**: Read/write projects
 - **viewer**: Read-only
 
 ### team_members
 
 User-team association with roles:
 ```sql
 id         UUID PRIMARY KEY
 team_id    UUID → teams(id)
 user_id    UUID → auth.users(id)
 role       TEXT → 'owner' | 'admin' | 'member' | 'viewer'
 ```
 
 ### projects
 
 Team-linked projects with status management.
 
 ### subscriptions
 
 Stripe subscription status storage.
 
 ## Migrations
 
 | File | Content |
 |------|---------|
 | `001_initial_schema.sql` | Base tables, triggers, RLS policies |
 | `002_rbac_audit.sql` | RBAC tables, audit logs, permission functions |
 | `003_projects_notifications_indexes.sql` | Notifications, index optimization |
 
 ## RLS Policies
 
 All tables use Row Level Security:
 - **profiles**: Users read/write own data (`id = auth.uid()`)
 - **teams**: Members read, owner/admin write
 - **team_members**: Users see own teams
 - **projects**: Team members access team projects
 - **subscriptions**: Owner/admin only
 
 ## Mock Mode
 
 When `NEXT_PUBLIC_MOCK_ENABLED=true`, no real Supabase needed:
 - `src/lib/mock/index.ts`: Mock query builder simulating PostgREST
 - `src/lib/mock/data.ts`: `@faker-js/faker` generated data
 - Supports eq, order, range, limit, single queries
 
 ## Generate Types
 
 ```bash
 pnpm db:types
 # supabase gen types typescript --linked > src/lib/supabase/database.types.ts
 ```
