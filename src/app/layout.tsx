/**
 * 根布局组件
 * 提供全局样式、字体和 Provider 包裹
 * 使用 next-intl 在服务端获取 locale 和 messages，传递给客户端 Provider
 */
import type { Metadata } from "next";
import { getLocale, getMessages } from "next-intl/server";
import { SITE_CONFIG } from "@/lib/constants";
import { Providers } from "./providers";
import "./globals.css";

/** openGraph.locale 需要下划线格式（如 zh_CN / en_US） */
function toOgLocale(locale: string): string {
  return locale.replace("-", "_");
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: {
      default: SITE_CONFIG.name,
      template: `%s | ${SITE_CONFIG.name}`,
    },
    description: SITE_CONFIG.description,
    metadataBase: new URL(SITE_CONFIG.url),
    openGraph: {
      type: "website",
      locale: toOgLocale(locale),
      url: SITE_CONFIG.url,
      title: SITE_CONFIG.name,
      description: SITE_CONFIG.description,
      siteName: SITE_CONFIG.name,
    },
    twitter: {
      card: "summary_large_image",
      title: SITE_CONFIG.name,
      description: SITE_CONFIG.description,
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // next-intl 服务端：从 Cookie 读取 locale，加载对应消息
  const locale = await getLocale();
  const messages = await getMessages();

  // 预连接 Supabase（Auth/REST 请求延迟优化）
  const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
    : null;

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {supabaseOrigin && (
          <>
            <link rel="preconnect" href={supabaseOrigin} />
            <link rel="dns-prefetch" href={supabaseOrigin} />
          </>
        )}
      </head>
      <body className="font-sans antialiased">
        {/* a11y：键盘用户跳过导航直达主内容 */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        >
          Skip to content / 跳到主要内容
        </a>
        <Providers locale={locale as never} messages={messages}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
