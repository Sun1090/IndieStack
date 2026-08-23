# ADR-003: 客户端数据层引入 TanStack Query

日期: 2026-08-23
状态: 已接受

## 背景
四个 dashboard 列表页各自手写 loading/error/refetch/竞态处理样板（约 120 行重复）。

## 决策
引入 @tanstack/react-query 作为客户端服务状态层：
查询用 useQuery（staleTime 30s），变更用 useMutation + invalidateQueries。

## 理由
- 内置竞态、缓存、重试、加载态，删除全部手写样板
- 渐进迁移：不改变现有 Server Components 数据获取方式

## 影响
- 新增依赖 ~13kB gzip（首屏共享 JS 仍 103kB）
- 后续新列表页必须使用 useQuery，不再手写 fetch 循环
