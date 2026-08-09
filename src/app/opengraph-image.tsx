/**
 * OG 图片生成（Next.js 内置，无需外部依赖）
 * 动态生成 1200×630 的社交分享图片
 * 参考：https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image
 */
import { ImageResponse } from "next/og";

export const alt = "IndieStack - 独立开发者的全栈 SaaS 启动模板";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)",
        }}
      >
        {/* 装饰性网格点 */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage:
              "radial-gradient(circle, rgba(99, 102, 241, 0.15) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1,
          }}
        >
          <div
            style={{
              fontSize: 80,
              fontWeight: 800,
              color: "#e2e8f0",
              letterSpacing: "-0.03em",
              lineHeight: 1,
            }}
          >
            IndieStack
          </div>
          <div
            style={{
              fontSize: 28,
              color: "#818cf8",
              marginTop: 20,
              fontWeight: 500,
            }}
          >
            独立开发者的全栈 SaaS 启动模板
          </div>
          <div
            style={{
              fontSize: 16,
              color: "#475569",
              marginTop: 40,
              display: "flex",
              gap: 24,
            }}
          >
            <span>Next.js</span>
            <span>Tailwind CSS</span>
            <span>shadcn/ui</span>
            <span>Supabase</span>
            <span>PostgreSQL</span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
