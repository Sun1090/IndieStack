/**
 * 博客文章详情页面（服务端组件）
 * 根据 slug 参数渲染具体文章内容
 * 标题、元信息与文章正文均由 next-intl 消息文件驱动，支持中英文
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";

type BlogPost = {
  title: string;
  excerpt: string;
  content: string;
  date: string;
  category: string;
  slug: string;
  author: string;
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const t = await getTranslations("blog");
  const post = (t.raw("posts") as BlogPost[]).find((p) => p.slug === slug);
  if (!post) return { title: t("metaTitle") };
  return {
    title: post.title,
    description: post.excerpt,
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = await getTranslations("blog");
  const post = (t.raw("posts") as BlogPost[]).find((p) => p.slug === slug);

  if (!post) {
    notFound();
  }

  return (
    <article className="container py-12 lg:py-20">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <Button variant="ghost" asChild className="mb-4">
            <Link href="/blog">
              <ArrowLeft className="mr-2 h-4 w-4" /> {t("backToBlog")}
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{post.category}</Badge>
            <span className="text-sm text-muted-foreground">{post.date}</span>
          </div>
          <h1 className="mt-4 text-4xl font-bold tracking-tight">{post.title}</h1>
          <p className="mt-2 text-muted-foreground">{t("by")} {post.author}</p>
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
