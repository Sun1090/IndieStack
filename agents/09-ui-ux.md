# UI/UX 设计 Agent

> 负责 IndieStack 项目的用户界面设计、组件规范和交互模式。

## 设计系统

### 技术栈
- **框架**: Tailwind CSS + shadcn/ui
- **图标**: Lucide React
- **主题**: `next-themes`（Dark / Light / System）
- **动画**: Tailwind 内置过渡 + shadcn/ui 动画

### 主题系统

主题通过 `next-themes` 和 Tailwind CSS 变量实现：
- CSS 变量在 `src/app/globals.css` 中使用 `@layer base` 定义
- Provider 在 `src/components/providers/theme-provider.tsx`
- 用户通过 `src/components/layout/theme-toggle.tsx` 切换
- 支持 Dark、Light、System 三种模式
- 主题偏好存储在 `localStorage`（key: `ui-theme`）

### 组件体系

#### shadcn/ui 原语（30 个）
所有位于 `src/components/ui/`：
`alert`, `avatar`, `badge`, `button`, `card`, `checkbox`, `collapsible`, `command`, `context-menu`, `dialog`, `dropdown-menu`, `input`, `kbd`, `label`, `popover`, `progress`, `radio-group`, `scroll-area`, `select`, `separator`, `sheet`, `skeleton`, `switch`, `table`, `tabs`, `textarea`, `toast`, `toaster`, `toggle`, `tooltip`

#### 共享组件（15 个）
位于 `src/components/shared/`：
- `Breadcrumbs` — 面包屑导航
- `ConfirmDialog` — 确认对话框（基于 Dialog）
- `EmptyState` — 空状态展示
- `ErrorState` — 错误展示
- `FormField` / `FormFieldControl` — 表单字段四件套，自动接 id 与 aria
- `GithubIcon` — 内联 GitHub 图标（lucide 1.x 移除了品牌图标）
- `InitialAvatar` — 姓名/邮箱首字母头像
- `NativeSelect` — 统一样式的原生 select
- `PageHeader` — 页面标题区
- `PageLoading` / `LoadingIndicator` — 路由级骨架与内联指示器（`aria-busy` / `role="status"`）
- `PasswordStrength` — 密码强度指示条
- `PermissionGate` — 权限条件渲染
- `QueryErrorState` — 查询失败重试卡片（展示层复用 ErrorState）
- `Section` — 内容分区
- `UploadProgress` — 上传进度条（含取消）

加载态、空态、错误态各自只有一个落脚点，写法由 `check:states` 守；组件清单与代码是否一致由
`check:component-docs` 守（它只解析表格与数量行，本节这种条目清单不在解析范围内）。

### 布局结构

#### 营销页面布局
```
├── SiteHeader（导航 + ThemeToggle + LocaleSwitcher）
├── Page Content
└── SiteFooter
```

#### 仪表盘布局
```
├── DashboardSidebar（可折叠）
├── 主内容区
│   ├── PageHeader
│   └── Children
└── SiteFooter
```

#### 管理后台布局
```
├── Admin 导航标签页
├── Role 守卫包装
└── Children
```

### 设计原则

1. **响应式设计**: 所有页面适配移动端和桌面端
2. **可访问性**: 使用语义化 HTML、ARIA 标签、键盘导航
3. **一致性**: 使用 shadcn/ui 组件库，不引入其他 UI 框架
4. **性能**: 默认 Server Components，最小化客户端 JS
5. **国际化**: 所有文本通过 i18n 管理

### 组件开发指南

```tsx
// 1. 选择正确的目录
// - 通用 UI: src/components/ui/
// - 页面专用: 就近放在 page 目录
// - 共享业务: src/components/shared/

// 2. 使用适当的 Props 接口
interface MyComponentProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
}

// 3. 接入国际化
"use client";
import { useTranslations } from "@/lib/i18n/client";

export function MyComponent() {
  const t = useTranslations("namespace");
  return <div>{t("key")}</div>;
}

// 4. 使用 Tailwind + shadcn/ui
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
```
