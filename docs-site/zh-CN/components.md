 # 组件库
 
 IndieStack 提供三层组件架构：基础 UI 组件（shadcn/ui）、共享业务组件、页面级组件。
 
 ## 组件目录结构
 
 ```
 src/components/
 ├── ui/             # 基础 UI 组件（shadcn/ui，24 个）
 ├── shared/         # 共享业务组件（11 个）
 ├── layout/         # 布局组件（5 个）
 ├── auth/           # 认证组件（2 个）
 ├── dashboard/      # 仪表盘组件
 ├── charts/         # 图表组件（基于 Recharts）
 ├── forms/          # 业务表单组件（5 个）
 ├── data-tables/    # 表格组件（基于 @tanstack/react-table）
 └── providers/      # React Context Provider
 ```
 
 ## shadcn/ui 组件（24 个）
 
 全部基于 Radix UI 构建，支持无障碍访问和深色/浅色主题。
 
 | 组件 | 用途 | Radix 基座 |
 |------|------|-----------|
 | Button | 按钮（6 种变体：default/primary/secondary/outline/ghost/destructive） | `@radix-ui/react-slot` |
 | Card | 卡片容器（header + content + footer） | - |
 | Dialog | 模态对话框 | `@radix-ui/react-dialog` |
 | DropdownMenu | 下拉菜单 | `@radix-ui/react-dropdown-menu` |
 | Input | 文本输入 | - |
 | Select | 选择器（含搜索） | `@radix-ui/react-select` |
 | Tabs | 标签页 | `@radix-ui/react-tabs` |
 | Table | 数据表格 | - |
 | Toast | 通知提示 | `@radix-ui/react-toast` |
 | Tooltip | 工具提示 | `@radix-ui/react-tooltip` |
 | Avatar | 用户头像 | `@radix-ui/react-avatar` |
 | Badge | 徽章 | - |
 | Switch | 开关 | `@radix-ui/react-switch` |
 | Checkbox | 复选框 | `@radix-ui/react-checkbox` |
 | Alert | 提示框（5 种变体） | - |
 | Sheet | 侧边面板（4 方向） | `@radix-ui/react-dialog` |
 | Skeleton | 骨架屏 | - |
 | Separator | 分隔线 | `@radix-ui/react-separator` |
 | Textarea | 多行输入 | - |
 | Toggle | 切换按钮 | `@radix-ui/react-toggle` |
 | Progress | 进度条 | `@radix-ui/react-progress` |
 | Label | 标签 | `@radix-ui/react-label` |
 | Popover | 弹出框 | `@radix-ui/react-popover` |
 | Collapsible | 折叠面板 | `@radix-ui/react-collapsible` |
 
 > 更多组件可通过 `npx shadcn@latest add` 按需添加
 
 ## 自定义组件
 
 | 组件 | 所在目录 | 用途 |
 |------|---------|------|
 | SiteHeader | `layout/` | 响应式导航栏（桌面/移动端），集成认证状态、主题切换、语言切换 |
 | SiteFooter | `layout/` | 页面底部，含导航链接分组和版权声明 |
 | DashboardSidebar | `layout/` | 仪表盘侧边栏，响应式折叠，自动识别管理员角色 |
 | ThemeToggle | `layout/` | 主题切换按钮（亮/暗） |
 | LocaleSwitcher | `layout/` | 语言切换下拉菜单（中文/英文） |
 | PermissionGate | `shared/` | 基于角色的权限门禁，控制 UI 元素可见性 |
 | ConfirmDialog | `shared/` | 通用确认对话框（支持自定义标题、描述、确认/取消文案） |
 | Breadcrumbs | `shared/` | 根据当前路径自动生成面包屑导航 |
 | EmptyState | `shared/` | 空数据状态占位（图标 + 标题 + 描述 + 操作按钮） |
 | LoadingState | `shared/` | 通用加载骨架屏 |
 | ErrorState | `shared/` | 通用错误状态展示（含重试按钮） |
 | SearchInput | `shared/` | 带搜索图标的输入框（含防抖处理） |
 | PageContainer | `shared/` | 页面容器（统一内边距和间距） |
 | PageHeader | `shared/` | 页面头部（标题 + 描述 + 操作按钮插槽） |
 | PageLoader | `shared/` | 全屏加载指示器 |
 | Section | `shared/` | 页面分区容器组件 |
 | StatsCard | `dashboard/` | 仪表盘统计卡片（含趋势指示器） |
 | DataTable | `data-tables/` | 通用数据表格（基于 @tanstack/react-table，支持排序/搜索/分页） |
 | AreaChart | `charts/` | 区域图表组件（基于 Recharts） |
 | LoginForm | `auth/` | 登录表单（邮箱 + GitHub + Google OAuth） |
 | RegisterForm | `auth/` | 注册表单 |
 | ProfileEditForm | `forms/` | 个人资料编辑表单 |
 | InviteMemberForm | `forms/` | 邀请团队成员表单 |
 | PasswordForm | `forms/` | 修改密码表单 |
 | NotificationSettingsForm | `forms/` | 通知偏好设置表单 |
 
 ## 组件使用示例
 
 ### PermissionGate 权限控制
 
 ```tsx
 <PermissionGate requirePermission="team:invite" fallback={<LockIcon />}>
   <Button onClick={inviteMember}>邀请成员</Button>
 </PermissionGate>
 ```
 
 ### ConfirmDialog 确认操作
 
 ```tsx
 <ConfirmDialog
   title="确认删除？"
   description="此操作不可恢复，确定要删除吗？"
   onConfirm={handleDelete}
   confirmText="删除"
   cancelText="取消"
 >
   <Button variant="destructive">删除项目</Button>
 </ConfirmDialog>
 ```
 
 ### DataTable 通用表格
 
 ```tsx
 const columns = [
   { accessorKey: "name", header: "名称" },
   { accessorKey: "status", header: "状态" },
   { accessorKey: "created_at", header: "创建时间" },
 ];
 <DataTable columns={columns} data={data} />
 ```
 
 ### StatsCard 统计卡片
 
 ```tsx
 <StatsCard
   title="月度收入"
   value="$12,234"
   description="较上月增长 12.5%"
   icon={CreditCard}
   trend={{ value: 12.5, positive: true }}
 />
 ```
 
 ## 组件开发原则
 
 1. **UI 组件**（`ui/`）：纯展示，无业务逻辑，直接来自 shadcn/ui
 2. **共享组件**（`shared/`）：可复用，含通用逻辑，不依赖具体页面
 3. **业务组件**（`forms/`, `dashboard/`）：特定业务场景，可引用共享组件
 4. **页面组件**（`app/`）：组装业务组件和 UI 组件，完成页面功能
 5. 组件内部文案使用 `useTranslations`（客户端）或 `getTranslations`（服务端）实现国际化
 6. 通过 `cn()` 工具函数和 Tailwind CSS 变量，所有组件自动支持主题切换
