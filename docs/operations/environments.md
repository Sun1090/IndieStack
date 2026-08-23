# 环境与 Staging 规范

## 环境拓扑

| 环境 | 分支 | Vercel | Supabase |
|------|------|--------|----------|
| 本地开发 | feature/* | `pnpm dev`（Mock 模式可离线） | 本地 supabase start / Mock |
| Preview | PR / develop | Vercel 自动 preview 部署 | **共享 staging Supabase 项目** |
| 生产 | main | Vercel production 域名 | 生产 Supabase 项目 |

## Staging 数据库规范

1. **独立项目**：staging 与生产必须是两个 Supabase 项目，严禁共用
2. **迁移先行**：schema 变更先在 staging 验证（`supabase db push`），确认后再对生产执行
3. **数据脱敏**：如从生产导入数据到 staging，必须脱敏（用户邮箱/手机号替换）
4. **种子数据**：使用 `supabase/seed.sql` 维护 staging 演示数据

## Preview 安全

- Vercel Deployment Protection 建议开启（防止 preview 被搜索引擎收录）
- Preview 环境的 `NEXT_PUBLIC_MOCK_ENABLED` 保持未设置（走真实 Supabase）
- Stripe 使用 test key；生产 webhook secret 不进 preview

## 发布流程

```
feat/* → develop → staging 验证 → PR 到 main → CI 七关 → Vercel 自动部署 → 部署验证清单
```

详见 [agents/10-release-manager.md](../../agents/10-release-manager.md) 的部署验证清单。
