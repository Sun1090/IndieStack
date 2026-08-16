/**
 * next-intl 请求配置
 * 在服务端根据请求上下文加载对应语言的消息
 *
 * 采用 localePrefix: 'never' 策略，locale 从 Cookie 读取，
 * 而非从 URL 路径解析。当 Cookie 未设置时，回退到默认语言。
 *
 * 消息文件按命名空间拆分存放于 messages/{locale}/{namespace}.json，
 * 此处聚合为单一 messages 对象供 next-intl 使用，
 * 与拆分前的单文件结构在运行时行为完全一致。
 */
import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { routing, LOCALE_COOKIE_NAME, getSafeLocale, type Locale } from "./routing";

/** 命名空间列表（与 messages/{locale}/ 下的文件名一一对应） */
const namespaces = [
  "common",
  "nav",
  "footer",
  "home",
  "features",
  "pricing",
  "about",
  "faq",
  "changelog",
  "contact",
  "blog",
  "privacy",
  "terms",
  "auth",
  "dashboard",
  "admin",
  "errors",
  "actions",
] as const;

/**
 * 加载指定语言的全部消息
 * 按命名空间逐个导入 messages/{locale}/{namespace}.json 并合并
 */
async function loadMessages(locale: Locale): Promise<Record<string, unknown>> {
  const messages: Record<string, unknown> = {};
  for (const ns of namespaces) {
    // JSON 模块默认导出即该命名空间的消息对象，通过 .default 取值
    const mod = await import(`../../messages/${locale}/${ns}.json`);
    messages[ns] = mod.default;
  }
  return messages;
}

export default getRequestConfig(async () => {
  // 从 Cookie 中读取用户语言偏好
  let locale: Locale;
  try {
    const cookieStore = await cookies();
    locale = getSafeLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
  } catch {
    // 在静态生成时 cookies() 不可用，回退到默认语言
    locale = routing.defaultLocale as Locale;
  }

  return {
    locale,
    messages: await loadMessages(locale),
    timeZone: "Asia/Shanghai",
  };
});
