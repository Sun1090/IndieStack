# ADR-009: React Table v9 经 useLegacyTable 桥迁移

日期: 2026-08-23
状态: 已接受（临时）

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
