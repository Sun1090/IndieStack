# ADR-002: i18n 采用 Cookie 方案而非 URL 前缀

日期: 2026-08-22
状态: 已接受

## 背景
next-intl 默认推荐 `/en/...` URL 前缀方案，利于 SEO；但本项目营销页已有既定路由结构。

## 决策
采用 Cookie 方案（localePrefix: 'never'），语言偏好存 `app-locale` cookie，默认 en。

## 理由
- 不改动既有路由结构，URL 保持简洁
- 语言切换器只需写 cookie + reload

## 影响
- 负面：SEO 上无法通过 URL 区分语言版本（可接受：营销页非 SEO 核心诉求）
- 注意：默认语言已从 zh-CN 改为 en（2026-08-22）
