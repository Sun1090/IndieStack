# 邮件模板设计方案

> Supabase Auth 的邮件（验证/邀请/重置密码）由 Supabase Dashboard → Authentication → Emails 配置，
> 不经过应用代码。本文档给出统一的模板设计与接线清单。

## 设计原则

1. **品牌一致**：与产品同色系（深蓝渐变 #0f172a → #1e4b4b），Logo 文本 "IndieStack"
2. **单一 CTA**：每封邮件只引导一个动作
3. **双语**：按 `profiles.language` 无法影响 Auth 邮件，采用英文为主、附中文摘要的双语布局
4. **安全提示**：底部固定"如果不是本人操作请忽略此邮件"

## 需要定制的模板（Supabase Dashboard）

| 模板 | 变量 | CTA |
|------|------|-----|
| Confirm Signup | `{{ .ConfirmationURL }}` | 确认邮箱 |
| Invite User | `{{ .InviteURL }}` | 接受邀请 |
| Magic Link | `{{ .ConfirmationURL }}` | 登录 |
| Change Email Address | `{{ .ConfirmationURL }}` | 确认新邮箱 |
| Reset Password | `{{ .RedirectTo }}` | 重置密码 |

## HTML 骨架（600px 宽，表格布局兼容客户端）

```html
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;font-family:-apple-system,'Segoe UI',sans-serif">
  <tr><td align="center" style="padding:32px 16px">
    <table width="600" style="background:#ffffff;border-radius:12px;overflow:hidden">
      <tr><td style="background:linear-gradient(135deg,#0f172a,#1e1b4b);padding:24px;text-align:center">
        <span style="color:#fff;font-size:20px;font-weight:700">IndieStack</span>
      </td></tr>
      <tr><td style="padding:32px">
        <h2 style="margin:0 0 8px;color:#0f172a">{{ 邮件标题 }}</h2>
        <p style="color:#475569;line-height:1.6">{{ 说明文字 }}</p>
        <a href="{{ CTA_URL }}"
           style="display:inline-block;margin:24px 0;padding:12px 32px;background:#2563eb;
                  color:#fff;border-radius:8px;text-decoration:none;font-weight:600">
          {{ CTA 文案 }}
        </a>
        <p style="color:#94a3b8;font-size:12px">
          或复制链接：<br>{{ CTA_URL }}
        </p>
      </td></tr>
      <tr><td style="padding:16px;background:#f1f5f9;text-align:center">
        <span style="color:#94a3b8;font-size:12px">
          If you didn't request this, please ignore this email. / 若非本人操作请忽略此邮件
        </span>
      </td></tr>
    </table>
  </td></tr>
</table>
```

## 接线清单

- [ ] Supabase Dashboard 逐模板粘贴上述骨架并替换变量
- [ ] SMTP：默认使用 Supabase 内置发件（限速），生产建议配置自定义 SMTP（Resend/阿里云邮件推送）
- [ ] 重定向域名白名单：Authentication → URL Configuration 加入生产/preview 域名
- [ ] 测试：分别触发注册/邀请/重置流程，检查各邮件客户端渲染（Gmail/Outlook/QQ 邮箱）
