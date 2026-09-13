# 文件存储

IndieStack 通过统一的 provider contract 提供头像和项目封面上传。默认使用 Supabase Storage；
OSS 四项配置完整时切换到阿里云 OSS，上传流程和业务代码无需改动。

## Provider 选择

| Provider | 默认 | 必需配置 |
| --- | --- | --- |
| Supabase Storage | 是 | Supabase 项目凭据与公共读 `avatars` 桶 |
| 阿里云 OSS | 否 | `OSS_BUCKET`、`OSS_REGION`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET` |

```bash
# 可选的 OSS 覆盖配置，四项必须同时提供。
OSS_BUCKET=your-bucket-name
OSS_REGION=oss-cn-hangzhou
OSS_ACCESS_KEY_ID=your-access-key-id
OSS_ACCESS_KEY_SECRET=your-access-key-secret
```

四项都存在时启用 OSS；完全未配置或只配置部分变量时使用 Supabase Storage。部分配置会输出
环境诊断告警和去重的 `provider.fallback` 指标，诊断信息不会包含任何凭据值。

## 上传流程

头像和项目封面共用同一条服务端上传链路：

1. 校验登录状态，并检查资源所有权或团队角色。
2. 只接受 PNG、JPEG、WebP，最大 2 MB。
3. 同时校验声明的 MIME 类型和真实文件签名。
4. 使用可信值生成对象 key，绝不使用用户上传的文件名。
5. 通过当前存储驱动写入对象，再把公开 URL 写回数据库。
6. 数据库回写失败时，尽力删除刚上传的对象。
7. 替换受管对象时，只有通过 prefix 和租户边界校验后才删除旧对象。

对象 key 格式：

```text
{prefix}/{tenant}/{timestamp}-{random}.{ext}
```

`prefix` 为 `avatars` 或 `covers`，`tenant` 为用户 ID 或项目 ID；扩展名来自 MIME 白名单映射，
不来自客户端文件名。

## 浏览器端点

个人资料和项目表单使用同源 XHR，支持上传进度和取消请求：

| 端点 | 资源 | 授权 |
| --- | --- | --- |
| `POST /api/uploads/avatar` | 当前用户头像 | 已登录用户 |
| `POST /api/uploads/project-cover` | 项目封面 | 团队 owner/admin |

两个路由都会拒绝跨站请求、执行限流和请求体上限，并与 Server Action 共用同一服务层。

## Supabase 桶

迁移 `024_storage_avatars_policies.sql` 创建或更新公共读 `avatars` 桶及其 Storage 策略。
已登录用户只能写入自己的一级目录。服务端通过 service role 执行读写、签名 URL 和清理。

个人资料和项目封面 URL 会直接嵌入页面，因此该桶保持公共读。禁止把私有文档放入此桶。

## OSS 行为

OSS 驱动沿用公共读桶模型，通过 `ali-oss` 实现 `put`、`signedUrl` 和 `remove`。两个 provider
的签名 URL 有效期都必须是 1 秒到 7 天之间的整数。

## 上传指标

两个指标分别回答不同的问题：

- `storage.upload.completed`（维度 `provider`、`outcome`）：每次 provider 对象写入结束上报一次，
  用于判断 OSS 或 Supabase 自身健康度。
- `upload.request.completed`（维度 `operation`、`outcome`）：每次上传请求结束上报一次，覆盖
  provider 写入、元数据回写与失败回滚整条链路，是反映用户实际结果的指标。

请求指标的 `outcome` 取值是 `success` / `failure` / `cancelled`；用户主动取消上传不能被算成存储故障。
provider 指标失败率超过 5%、或请求指标失败率超过 10%，都值得排查。

两个指标名与维度取值都来自 `src/lib/observability/storage-metrics.ts`，调用点不要手写字面量。

清理失败只记录结构化日志，不反向破坏已经成功的数据库写入，因为数据库仍是事实来源。

## 限制与恢复

- 当前通过应用服务端中转文件，尚未提供签名直传。
- 目前没有 provider 无关的对象 list 或自动孤儿扫描 API。
- 增加批量清理前，需要先实现受限 list contract、dry-run 报告和租户审计；禁止按任意 URL 或
  用户输入批量删除。
- 清理是 best-effort；失败任务会保留结构化信息供后续修复，不会被伪装成成功。

## 验证

```bash
pnpm test -- src/lib/storage/index.test.ts src/lib/uploads
pnpm test -- src/app/api/uploads
pnpm test:e2e -- e2e/uploads.spec.ts
```

