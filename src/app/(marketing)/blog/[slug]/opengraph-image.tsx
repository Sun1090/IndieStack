/**
 * 博客文章动态 OG 图
 * 按slug 渲染标题与分类的 1200×630 分享卡片
 */
import { ImageResponse } from "next/og";
import fs from "node:fs";
import path from "node:path";

export const alt = "IndieStack Blog";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

interface Post {
  slug: string;
  title: string;
  category?: string;
}

/** 从双语消息中按 slug 查找文章（默认语言优先） */
function findPost(slug: string): Post | null {
  for (const locale of ["en", "zh-CN"]) {
    try {
      const raw = fs.readFileSync(
        path.join(process.cwd(), "messages", locale, "blog.json"),
        "utf8",
      );
      const posts = (JSON.parse(raw).posts ?? []) as Post[];
      const found = posts.find((p) => p.slug === slug);
      if (found) return found;
    } catch {
      // 继续尝试下一个 locale
    }
  }
  return null;
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = findPost(slug);

  const title = post?.title ?? "IndieStack Blog";
  const category = post?.category ?? "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px",
          background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)",
          color: "#fff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: "#2563eb",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 28,
              fontWeight: 700,
            }}
          >
            IS
          </div>
          <span style={{ fontSize: 24, opacity: 0.85 }}>IndieStack</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {category && (
            <span
              style={{
                alignSelf: "flex-start",
                background: "rgba(37,99,235,0.25)",
                border: "1px solid #2563eb",
                borderRadius: 999,
                padding: "6px 18px",
                fontSize: 22,
              }}
            >
              {category}
            </span>
          )}
          <div
            style={{
              display: "flex",
              fontSize: title.length > 40 ? 52 : 64,
              fontWeight: 700,
              lineHeight: 1.15,
              maxWidth: "92%",
            }}
          >
            {title}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", opacity: 0.7 }}>
          <span style={{ fontSize: 22 }}>IndieStack for Indie Developers</span>
          <span style={{ fontSize: 22 }}>indie-stack-theta.vercel.app</span>
        </div>
      </div>
    ),
    size,
  );
}
