/**
 * 动态 OG 图生成
 * GET /api/og?title=<text>&category=<text>
 * 博客文章的 generateMetadata 引用本端点作为分享图
 */
import { ImageResponse } from "next/og";
import { createRateLimit } from "@/lib/rate-limit";

export const contentType = "image/png";

/**
 * 按 IP 的滑窗，60 次/分钟。
 *
 * **这条端点天然要能被陌生人打**：它挂在 `<meta og:image>` 上，社交预览爬虫与搜索引擎
 * 都是以**用户的 IP** 来取的，所以按会话限频在这里不成立——但按 IP 是成立的：
 * 正常爬虫每个页面取一次，60/分钟绰绰有余；同一个 IP 反复取就是异常。
 *
 * **为什么是窗口而不是台账条目原本写着的「按参数做缓存」**：参数缓存挡不住这个端点真实的
 * 放大方式——变一下 title 就是一个新键，于是任何缓存都以「每个键只算一次」收口，
 * 而攻击者要的正是这个。窗口按**来的人**算，与参数无关，那才是能收住的东西。
 * （参数缓存另有价值：同一篇文章被反复分享时不必重新合成。但它是 CDN 的活——
 * 响应已经带 `s-maxage=86400`——所以不重复实现。）
 */
const ogRateLimit = createRateLimit({ maxRequests: 60, windowMs: 60_000 });

export async function GET(request: Request) {
  const limits = await ogRateLimit.check(request);
  if (!limits.allowed) {
    return new Response(null, {
      status: 429,
      headers: {
        // 429 不能长缓存：窗口一过就该立刻能用。
        "Cache-Control": "no-store, must-revalidate",
        "Retry-After": String(Math.max(1, Math.ceil(limits.resetIn / 1000))),
      },
    });
  }

  const { searchParams } = new URL(request.url);
  // 参数校验：截断 + 去控制字符（防 Satori 渲染异常），空标题回退默认
  const clean = (v: string | null, max: number, fallback: string) => {
    const s = (v ?? "").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max);
    return s || fallback;
  };
  const title = clean(searchParams.get("title"), 80, "IndieStack");
  const rawCategory = clean(searchParams.get("category"), 40, "");
  const category = rawCategory || undefined;

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
    {
      width: 1200,
      height: 630,
      // 图片内容完全由参数决定，可被 CDN 长缓存
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400",
      },
    },
  );
}
