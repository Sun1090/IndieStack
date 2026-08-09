/** * 博客列表页面（服务端组件） * 展示所有博客文章的列表，按发布日期排序 */

import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Blog",
  description: "Latest updates, tutorials, and news",
};

const posts = [
  {
    title: "Building a SaaS in 2026: The Complete Stack Guide",
    excerpt: "A comprehensive look at the tools and technologies we use to ship fast.",
    date: "2026-07-15",
    category: "Engineering",
    slug: "building-saas-2026",
    author: "IndieStack Team",
  },
  {
    title: "Why Supabase is the Perfect Backend for Indie Developers",
    excerpt: "From auth to real-time subscriptions, here's why Supabase wins.",
    date: "2026-07-10",
    category: "Backend",
    slug: "supabase-indie-dev",
    author: "IndieStack Team",
  },
  {
    title: "Setting Up Sentry for Next.js: A Step-by-Step Guide",
    excerpt: "Get error monitoring up and running in under 10 minutes.",
    date: "2026-07-05",
    category: "Tutorial",
    slug: "sentry-nextjs-setup",
    author: "IndieStack Team",
  },
  {
    title: "Rethinking Authentication in Modern Web Apps",
    excerpt: "How Supabase SSR auth works with Next.js App Router.",
    date: "2026-06-28",
    category: "Architecture",
    slug: "modern-auth-patterns",
    author: "IndieStack Team",
  },
];

export default function BlogPage() {
  return (
    <div className="container py-12 lg:py-20">
      {/* Header */}
      <div className="mx-auto max-w-3xl text-center">
        <Badge variant="secondary" className="mb-4">Blog</Badge>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Latest from the blog
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Tutorials, guides, and insights for independent developers.
        </p>
      </div>

      {/* Posts */}
      <div className="mt-12 grid gap-8 md:grid-cols-2">
        {posts.map((post) => (
          <Link key={post.slug} href={`/blog/${post.slug}`}>
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{post.category}</Badge>
                  <span className="text-xs text-muted-foreground">{post.date}</span>
                </div>
                <CardTitle className="mt-2 text-xl">{post.title}</CardTitle>
                <CardDescription className="line-clamp-2">{post.excerpt}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>{post.author}</span>
                  <span>·</span>
                  <span>5 min read</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
