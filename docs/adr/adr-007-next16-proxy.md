# ADR-007: Next.js 16 升级与 middleware→proxy 更名

日期: 2026-08-23
状态: 已接受

## 决策
升级 Next.js 16（Turbopack 默认构建引擎），middleware.ts 经官方 codemod 更名 proxy.ts。

## 关键破坏点与处置
| 破坏点 | 处置 |
|---|---|
| favicon.ico 非 RGBA 被 Turbopack 拒绝 | 移除，icon.svg 兜底 |
| middleware 文件约定更名 | proxy.ts + proxy.test.ts 同步改名 |
| eslint-config-next 16 为原生 flat config | 删除 FlatCompat 桥接 |
| react-hooks/purity 新规则 | Date.now() 提取为模块级函数 |

## 影响
- 构建更快（Turbopack）；构建输出不再打印逐路由体积 → check-bundle 改为统计 .next/static 实际文件大小
