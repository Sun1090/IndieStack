# ADR-010: 对象存储抽象与阿里云 OSS 接入

- 状态：accepted
- 日期：2026-09-05
- 关联：v0.5.0 roadmap B01/B02/B03；v0.6.0 roadmap G08；`docs/adr/adr-008-repository.md`（数据访问收口约定）

## 背景

v0.4.0 仅对对象存储做了 ADR 倾向性讨论（当时结论：OSS 只做决策不写生产代码）。
v0.5.0 头像上传（B02）产生真实的文件写入需求，需要落定存储方案。

## 决策

1. **双驱动抽象**：新增 `src/lib/storage/`，业务与 action 只面向 `StorageDriver`
   接口（`put(key, body, contentType) → url`）。
   - **默认驱动：Supabase Storage**。零新依赖、凭据已就绪、与既有 RLS/前端栈同源，
     满足 Reuse First。
   - **OSS 驱动：阿里云 OSS（`ali-oss` SDK）**，仅当
     `OSS_BUCKET/OSS_REGION/OSS_ACCESS_KEY_ID/OSS_ACCESS_KEY_SECRET` 四项齐备时启用；
     配置不完整时回退 Supabase 并在 env 诊断中告警。SDK 经 `require` 动态加载，
     默认路径（未配置 OSS）不引入该包。
2. **服务端中转上传**：文件始终经应用服务端中转（≤2MB 图片），不做浏览器到对象
   存储的签名直传。普通调用可走 Server Action；需要上传进度与取消时，浏览器通过
   同源 `/api/uploads/*` Route Handler 发送 multipart，Route 与 Action 共用
   `src/lib/uploads/service.ts`，不复制鉴权、校验或回滚规则。对象存储签名直传仍为
   后续优化（需要 STS/签名 URL 与 CORS 配置）。
3. **安全约束**：content-type 白名单（png/jpeg/webp）→ 扩展名取自白名单映射
   而非用户文件名，杜绝路径穿越与任意后缀；对象键 `{prefix}/{userId}/{timestamp}-{random}.{ext}`。
4. **桶约定**：Supabase Storage 桶 `avatars`（公共读），上线前需创建；
   OSS 侧同样要求目标桶公共读。

## 理由

- 头像等公共读小文件用对象存储公共 URL 最简单，无需经应用代理。
- 保留 OSS 驱动是为了满足国内访问速度与成本目标（v0.4.0 ADR 倾向的延续），
  但默认 Supabase 保证了"无 OSS 凭据环境"（本地/CI/preview）开箱即用。
- 服务端中转在 2MB 上限下延迟可接受，且把安全校验完全收口在服务端。

## 后果

- 新增依赖 `ali-oss`（及 `@types/ali-oss`）：storage 抽象的 OSS 驱动需要官方 SDK；
  默认路径动态加载，不影响未配置 OSS 的部署。
- `avatars` 桶缺失时上传报错（Action/Route 均返回 uploadFailed），需运维步骤配套。
- B03（项目封面）复用同一抽象，仅需新增前缀与大小上限。
- G08 的 XHR 取消只中止浏览器请求；若对象已写入而请求随后取消，service 会尽力清理
  新对象，清理失败只记录结构化错误，不伪装成成功。
