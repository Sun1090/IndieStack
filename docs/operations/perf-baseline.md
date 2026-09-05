# 前端性能基线与复审记录

> v0.5.0 E03 首屏性能复审结论（2026-09-05）。门禁：`pnpm check:perf` + `pnpm check:bundle`
> （CI 中随 Build job 运行），本文件记录复审时的基线与决策。

## 当前基线（v0.5.0）

| 指标 | 数值 | 门禁 |
|------|------|------|
| 客户端 CSS 总体积 | 68kB | 单文件 < 100kB（check-perf） |
| 客户端静态资源总量 | ~2626kB | 基线 2603kB + 容差（check-bundle） |
| recharts | 独立 chunk，经 next/dynamic 懒加载 | 存在性断言（check-perf） |
| sourcemap | 不随产物发布 | 泄漏断言（check-perf） |

## 复审结论（E03）

1. **字体**：使用系统字体栈（`font-sans`），无 webfont 加载，无 FOUT/阻塞风险——保持现状，
   引入 webfont 前需重新评估 preload 与 `font-display`。
2. **首屏 LCP**：营销首页为 SSR 文本块（无首屏图片、无 webfont），LCP 元素即 HTML 文本，
   无 preload 收益点；`public/` 下仅有的两张捐赠二维码图（各 ≤200kB）未被任何页面首屏引用。
3. **preconnect**：Supabase origin 已有 preconnect + dns-prefetch；本次修正补上
   `crossOrigin="anonymous"`——supabase-js 为带 apikey 头的匿名 CORS 请求，
   不带 crossorigin 的 preconnect 只完成 DNS/TCP，无法复用 TLS 连接。
4. **重依赖**：recharts（图表）与 @simplewebauthn/browser（passkey）均不在营销首屏；
   recharts 经 `next/dynamic` 拆为独立 chunk，passkey 组件仅在 feature flag 开启的设置页出现。
5. **图片规范**：站内无 `next/image` 首屏依赖；如未来接入真实头像/封面展示，
   域名白名单已预置（`*.supabase.co` / `*.aliyuncs.com`，见 next.config.ts）。

## 后续优化候选（v0.6.0+）

- 营销页静态化评估（当前因 i18n cookie 走动态渲染，SSG + ISR 可降 TTFB）。
- Supabase Storage 签名直传（B 系列遗留，直传后可移除服务端中转的 2MB 限制）。
- React Compiler / Partial Prerendering（等 Next 版本成熟度）。
