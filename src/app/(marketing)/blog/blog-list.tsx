"use client";

/**
 * 博客列表（客户端分类过滤）
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Post {
  slug: string;
  title: string;
  excerpt?: string;
  category?: string;
  date?: string;
}

export function BlogList({ posts, labels }: { posts: Post[]; labels: Record<string, string> }) {
  const categories = useMemo(
    () => ["all", ...Array.from(new Set(posts.map((p) => p.category ?? "general")))],
    [posts],
  );
  const [active, setActive] = useState("all");

  const filtered =
    active === "all" ? posts : posts.filter((p) => (p.category ?? "general") === active);

  return (
    <>
      <div className="mx-auto mt-8 flex max-w-3xl flex-wrap justify-center gap-2">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setActive(cat)}
            className={cn(
              "rounded-full border px-4 py-1 text-sm transition-colors",
              active === cat
                ? "border-primary bg-primary/10 font-medium"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            {labels[cat] ?? cat}
          </button>
        ))}
      </div>

      <div className="container mx-auto mt-12 grid max-w-5xl gap-8 px-4 md:grid-cols-2">
        {filtered.length === 0 ? (
          <p className="col-span-full py-12 text-center text-muted-foreground">
            {labels.empty ?? ""}
          </p>
        ) : (
          filtered.map((post) => (
            <Link key={post.slug} href={`/blog/${post.slug}`}>
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    {post.category && <Badge variant="secondary">{post.category}</Badge>}
                    <span className="text-xs text-muted-foreground">{post.date}</span>
                  </div>
                  <CardTitle>{post.title}</CardTitle>
                  {post.excerpt && <CardDescription>{post.excerpt}</CardDescription>}
                </CardHeader>
                <CardContent />
              </Card>
            </Link>
          ))
        )}
      </div>
    </>
  );
}
