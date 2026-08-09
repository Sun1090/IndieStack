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

export const metadata: Metadata = {
  title: {
    default: SITE_CONFIG.name,
    template: `%s | ${SITE_CONFIG.name}`,
  },
  description: SITE_CONFIG.description,
  metadataBase: new URL(SITE_CONFIG.url),
  openGraph: {
    type: "website",
    locale: "zh_CN",
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // next-intl 服务端：从 Cookie 读取 locale，加载对应消息
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Providers locale={locale as never} messages={messages}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
