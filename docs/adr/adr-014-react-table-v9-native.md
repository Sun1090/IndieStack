# ADR-014: React Table v9 原生 API 迁移

日期: 2026-08-23
状态: 已接受

## 背景

ADR-009 为缩短 `@tanstack/react-table` v9 升级窗口，临时采用 `@tanstack/react-table/legacy`
的 `useLegacyTable` 与 v8 行模型 API。legacy 桥会打包全部 features，且让泛型与组件边界长期
停留在过渡形态；使用数日后，团队已具备直接接入 v9 features/row model 槽位的条件。

## 决策

1. 移除 `@tanstack/react-table/legacy` 桥，全面迁移到 v9 原生 API。
2. 在 `src/components/data-tables/features.ts` 集中声明组件与测试共享的精确 features 类型。
3. 将行模型工厂注册到 `tableFeatures` 槽位，依赖 v9 的按需特性与 tree-shaking。
4. ADR-009 标记为“已废弃（被 ADR-014 取代）”，保留其迁移背景但不再作为当前约束。

## 理由

- 原生 API 能获得细粒度 feature 注册与更小的客户端 bundle，legacy 桥的过渡收益已经结束。
- features 类型集中后，DataTable 的泛型接线只维护一处，避免各调用方重复声明 `_features`。
- 官方 v9 原生路径已稳定，继续停留在 legacy 桥会增加后续升级成本。

## 影响

- `@tanstack/react-table/legacy` 不再允许出现在源码中；重新引入需要新的 ADR 说明迁移窗口。
- DataTable 行模型与 features 配置必须通过 `src/components/data-tables/features.ts` 共享，
  组件测试和生产构建共同承担行为与 tree-shaking 回归门禁。
- ADR-009 的历史内容保留，便于追溯 v8 → legacy → v9 原生两阶段迁移过程。
