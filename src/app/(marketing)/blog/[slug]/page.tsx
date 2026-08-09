/** * 博客文章详情页面（服务端组件） * 根据 slug 参数渲染具体文章内容 * 支持 Markdown 渲染和代码高亮 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

// In a real app, this would come from a CMS or database
const posts: Record<string, { title: string; content: string; date: string; category: string; author: string }> = {
  "building-saas-2026": {
    title: "Building a SaaS in 2026: The Complete Stack Guide",
    date: "2026-07-15",
    category: "Engineering",
    author: "IndieStack Team",
    content: `
## The Modern SaaS Stack

Building a SaaS product in 2026 is both easier and harder than ever. The tools are better, but the expectations are higher. Here's our complete stack and why we chose each piece.

### Frontend: Next.js 15

Next.js 15 with the App Router provides server components by default, streaming, and partial prerendering. Combined with Tailwind CSS and shadcn/ui, we get a beautiful, accessible UI without the overhead of a component library.

### Backend: Supabase

Supabase handles authentication, PostgreSQL database, real-time subscriptions, and file storage. It's open source, scales well, and integrates seamlessly with Next.js through the supabase-ssr package.

### Monitoring: Sentry

Sentry provides real-time error tracking, performance monitoring, and crash reports. It integrates with Next.js out of the box.

### Deployment: Vercel + Alibaba Cloud

Vercel handles the frontend deployment with automatic preview deployments for every PR. Alibaba Cloud OSS serves static assets through CDN.

### Why This Stack Works

1. **Cohesive**: Every piece integrates well with the others
2. **Cost-effective**: Generous free tiers on Supabase and Vercel
3. **Productivity**: Minimal boilerplate, maximum output
4. **Production-ready**: Battle-tested at scale

## Getting Started

The best way to get started is to clone the template and follow the setup guide. You'll have a working app with auth, database, and monitoring in under 30 minutes.
    `,
  },
  "supabase-indie-dev": {
    title: "Why Supabase is the Perfect Backend for Indie Developers",
    date: "2026-07-10",
    category: "Backend",
    author: "IndieStack Team",
    content: `
## Supabase: The Backend That Grows With You

As an indie developer, you need a backend that's powerful enough for production but simple enough to get started quickly. Supabase is that backend.

### What Makes Supabase Special

- **PostgreSQL**: Real, full-featured PostgreSQL. Not a toy.
- **Auth**: Built-in auth with email/password, OAuth, and social login
- **Realtime**: WebSocket-based real-time subscriptions
- **Storage**: File storage with CDN
- **Row Level Security**: Fine-grained access control at the database level

### The Indie Developer Advantage

For indie developers, Supabase's generous free tier is a game-changer. You get:
- 2 PostgreSQL databases
- 50,000 monthly active users
- 2 GB database size
- 1 GB file storage
- Real-time connections

All for free. That's enough to launch and grow to thousands of users.

### Integration with Next.js

The @supabase/ssr package makes it trivial to integrate with Next.js 15's App Router. Server-side rendering, middleware, and client components all work seamlessly.
    `,
  },
  "sentry-nextjs-setup": {
    title: "Setting Up Sentry for Next.js: A Step-by-Step Guide",
    date: "2026-07-05",
    category: "Tutorial",
    author: "IndieStack Team",
    content: `
## Sentry + Next.js: Complete Setup Guide

Error monitoring is essential for any production application. Here's how to set up Sentry with Next.js 15.

### Step 1: Install the Package

\`\`\`bash
pnpm add @sentry/nextjs
\`\`\`

### Step 2: Configure Sentry

Create \`sentry.client.config.ts\`, \`sentry.server.config.ts\`, and \`sentry.edge.config.ts\`:

\`\`\`typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  debug: false,
});
\`\`\`

### Step 3: Add Environment Variables

\`\`\`
NEXT_PUBLIC_SENTRY_DSN=https://your-dsn@sentry.io/your-project
SENTRY_ORG=your-org
SENTRY_PROJECT=your-project
SENTRY_AUTH_TOKEN=your-token
\`\`\`

### Step 4: Deploy

Sentry will automatically upload source maps during build. Errors in production will have full stack traces.
    `,
  },
  "modern-auth-patterns": {
    title: "Rethinking Authentication in Modern Web Apps",
    date: "2026-06-28",
    category: "Architecture",
    author: "IndieStack Team",
    content: `
## Modern Auth Patterns for Next.js

Authentication has evolved significantly. Here's how we structure auth in our SaaS template.

### The Problem

Traditional auth patterns don't work well with React Server Components. You can't use hooks in server components, and you need the user session available on both server and client.

### The Solution: SSR Auth

Supabase's SSR package solves this elegantly:

1. **Middleware**: Checks session on every request and refreshes the cookie
2. **Server Client**: \`createClient()\` in server components reads cookies
3. **Client Client**: \`createClient()\` in browser components uses the same cookie

### Data Flow

\`\`\`
Request → Middleware (refresh session) → Server Component → Client Component
                              ↓
                        Cookie stored
                              ↓
                    Client reads cookie via createBrowserClient
\`\`\`

### Protected Routes

Middleware checks for protected routes and redirects unauthenticated users to the login page. Auth pages redirect authenticated users to the dashboard.

### Why This Matters

This pattern gives us:
- No flash of unauthenticated content
- SEO-friendly pages
- Type-safe auth across server and client
- Minimal boilerplate
    `,
  },
};

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = posts[slug];

  if (!post) {
    notFound();
  }

  return (
    <article className="container py-12 lg:py-20">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <Button variant="ghost" asChild className="mb-4">
            <Link href="/blog">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Blog
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{post.category}</Badge>
            <span className="text-sm text-muted-foreground">{post.date}</span>
          </div>
          <h1 className="mt-4 text-4xl font-bold tracking-tight">{post.title}</h1>
          <p className="mt-2 text-muted-foreground">By {post.author}</p>
        </div>

        <div className="max-w-none">
          {renderContent(post.content)}
        </div>
      </div>
    </article>
  );
}
function renderContent(content: string) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeKey = 0;
  let listItems: React.ReactNode[] = [];
  let listType: "ul" | "ol" | null = null;

  function flushList() {
    if (listItems.length > 0) {
      if (listType === "ol") {
        elements.push(<ol key={`ol-${codeKey++}`} className="my-4 list-decimal space-y-1 pl-6">{listItems}</ol>);
      } else {
        elements.push(<ul key={`ul-${codeKey++}`} className="my-4 list-disc space-y-1 pl-6">{listItems}</ul>);
      }
      listItems = [];
      listType = null;
    }
  }

  lines.forEach((line, i) => {
    const trimmed = line.trimEnd();

    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${codeKey++}`} className="my-4 overflow-x-auto rounded-lg bg-muted p-4 text-sm">
            <code>{codeLines.join("\n")}</code>
          </pre>
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        flushList();
        inCodeBlock = true;
      }
      return;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      return;
    }

    flushList();

    if (trimmed.startsWith("## ")) {
      elements.push(<h2 key={i} className="mb-4 mt-8 text-2xl font-bold">{trimmed.slice(3)}</h2>);
    } else if (trimmed.startsWith("### ")) {
      elements.push(<h3 key={i} className="mb-3 mt-6 text-xl font-semibold">{trimmed.slice(4)}</h3>);
    } else if (trimmed.startsWith("1. ") || trimmed.startsWith("2. ") || trimmed.startsWith("3. ")) {
      const text = trimmed.replace(/^\d+\.\s*/, "");
      listType = "ol";
      listItems.push(<li key={i}>{renderInline(text)}</li>);
    } else if (trimmed.startsWith("- ")) {
      listType = "ul";
      listItems.push(<li key={i}>{renderInline(trimmed.slice(2))}</li>);
    } else if (trimmed === "") {
      elements.push(<div key={i} className="h-4" />);
    } else {
      elements.push(<p key={i} className="leading-relaxed">{renderInline(trimmed)}</p>);
    }
  });

  // Flush any remaining
  if (inCodeBlock) {
    elements.push(
      <pre key={`code-${codeKey}`} className="my-4 overflow-x-auto rounded-lg bg-muted p-4 text-sm">
        <code>{codeLines.join("\n")}</code>
      </pre>
    );
  }
  flushList();

  return elements;
}

function renderInline(text: string) {
  // Bold: **text**
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    // Inline code: `text`
    const codeParts = part.split(/(`.*?`)/g);
    if (codeParts.length === 1) return part;
    return codeParts.map((cp, j) => {
      if (cp.startsWith("`") && cp.endsWith("`")) {
        return <code key={`${i}-${j}`} className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono">{cp.slice(1, -1)}</code>;
      }
      return cp;
    });
  });
}
