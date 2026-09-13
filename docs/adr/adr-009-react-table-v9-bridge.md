# ADR-009: React Table v9 经 useLegacyTable 桥迁移

日期: 2026-08-23
状态: 已废弃（被 ADR-014 取代）

## 背景
`@tanstack/react-table` 升级到 v9 后，原生 API 的泛型与 features/row model 接线显著变化；为缩短迁移窗口，先引入官方 legacy 桥保持既有 DataTable 行为。

## 决策
升级 @tanstack/react-table v9 后，DataTable 使用 `@tanstack/react-table/legacy` 的
useLegacyTable + get*RowModel（v8 API / v9 内核）。

## 理由
v9 原生 API 要求显式 _features/_rowModels 且泛型签名变化（ColumnDef<TFeatures, TData>），
对可复用泛型组件侵入过大；官方提供 legacy 桥作为过渡。

## 触发重写条件
- shadcn/ui 生态完成 v9 适配
- 需要 v9 特性（细粒度 atom 订阅、tree-shaking features）

## 影响
- legacy 桥打包全部 features，bundle 大于原生按需引入（当前总量可控）

## 后记（2026-08-23）

legacy 桥使用数日后已完成原生 API 重写，正式决策见 [ADR-014](adr-014-react-table-v9-native.md)：
- features 抽离至 `src/components/data-tables/features.ts`（组件与测试共享精确类型）
- 行模型工厂注册于 tableFeatures 槽位（tree-shaking 生效）
- 移除 `@tanstack/react-table/legacy` 引用
