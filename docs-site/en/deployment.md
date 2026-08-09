# Deployment

IndieStack supports multiple deployment strategies. We recommend Vercel for one-click deployment, but Docker and traditional server deployment are also supported.

## Vercel Deployment (Recommended)

### Prerequisites

- [Vercel](https://vercel.com) account (sign in with GitHub)
- Git repository pushed to GitHub

### One-Click Deploy

Vercel auto-detects Next.js and configures build settings:

```bash
# Install Vercel CLI
npm i -g vercel

# Log in to Vercel
vercel login

# Deploy to production
vercel --prod
```

### Manual Deploy (Vercel Dashboard)

1. Go to [Vercel Dashboard](https://vercel.com/new), click "New Project"
2. Import your GitHub repository
3. Framework auto-detects **Next.js** (no manual selection needed)
4. Add environment variables (copy required ones from `.env.example`)
5. Click "Deploy"

### Environment Variables

Add these in Vercel Dashboard → Project → Settings → Environment Variables:

| Environment | Source | Notes |
|-------------|--------|-------|
| Production | Vercel Dashboard → Settings → Environment Variables | Production config |
| Preview | Same as Production | Preview deploys inherit from Production |
| Development | `.env.local` | Local dev config |

### Custom Domain

```bash
# Via CLI
vercel domains add yourdomain.com

# Or via Dashboard → Project → Settings → Domains
```

### Preview Deployments

Pushing a PR or branch automatically creates a Preview deployment with a unique URL for team review.

## Docker Deployment

### Build Image

The project includes a multi-stage `Dockerfile` for optimized image size:

```bash
# Build Docker image
docker build -t indiestack .

# Run container
docker run -d -p 3000:3000 --env-file .env.production indiestack
```

### Docker Compose

The project includes `docker-compose.yml` with app + PostgreSQL:

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f

# Stop services
docker compose down
```

### Production Docker Compose

Create `docker-compose.prod.yml` for production:

```yaml
version: "3.8"
services:
  app:
    build: .
    ports:
      - "3000:3000"
    env_file: .env.production
    restart: always
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

## Traditional Server Deployment

### PM2 + Nginx

```bash
# Build project
pnpm build

# Start with PM2
pnpm install -g pm2
pm2 start npm --name "indiestack" -- start
pm2 save
pm2 startup
```

Nginx reverse proxy configuration:

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## GitHub Actions CI/CD

The `.github/workflows/` directory contains pre-configured CI/CD workflows:

### `ci.yml` — PR Checks

Runs on every push and PR:
- TypeScript type check (`pnpm type-check`)
- ESLint check (`pnpm lint`)
- Unit tests (`pnpm test`)
- Build verification (`pnpm build`)

### `deploy.yml` — Auto Deploy

Triggered on push to `main` branch:
- Automatic build and deploy to Vercel
- Slack/email notifications (optional)
- Rollback support

### Configure Secrets

Add in GitHub repo Settings → Secrets and variables → Actions:

```bash
VERCEL_TOKEN=your-vercel-token
VERCEL_ORG_ID=your-org-id
VERCEL_PROJECT_ID=your-project-id
VERCEL_DOCS_PROJECT_ID=your-docs-project-id
```

## Database Deployment

### Supabase Production

1. Create project in [Supabase Dashboard](https://supabase.com)
2. Run database migrations:

```bash
npx supabase login
npx supabase link --project-ref your-project-ref
pnpm db:push
```

3. Enable Row Level Security:

```bash
npx supabase db push
```

4. Configure Auth settings (URLs, redirect domains, etc.)

### Database Backup

```bash
# Backup with Supabase CLI
npx supabase db dump -f backup.sql

# Restore
npx supabase db import -f backup.sql
```

## Docs Site Deployment

The docs site (VitePress) is a standalone static site that can be deployed independently:

### Vercel

```bash
cd docs-site

# Install dependencies
pnpm install

# Build static files
pnpm build

# Deploy to Vercel
vercel --prod
```

### Docker

```bash
cd docs-site

# Build Docker image (Nginx-based)
docker build -t indiestack-docs .

# Run
docker run -d -p 8080:80 indiestack-docs
```

### Nginx

`docs-site/nginx.conf` is pre-configured with Gzip, caching, and SPA fallback:

```bash
# Build static files
cd docs-site && pnpm build

# Deploy dist to Nginx
cp -r .vitepress/dist/* /var/www/docs/
```

## Pre-Launch Checklist

### Before Going Live

- [ ] Verify all environment variables
- [ ] Run database migrations
- [ ] Enable Supabase RLS
- [ ] Configure Stripe Webhook
- [ ] Set up Sentry DSN
- [ ] Bind custom domain
- [ ] Configure SSL certificate
- [ ] Verify CI/CD workflows
- [ ] Run performance tests
- [ ] Verify error monitoring
- [ ] Check OG images and SEO tags
- [ ] Verify sitemap.xml and robots.txt
- [ ] Deploy and update docs site
