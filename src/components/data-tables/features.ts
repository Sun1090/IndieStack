/**
 * DataTable 共享特性声明
 * 组件与测试共用同一 features 实例，保证 ColumnDef 泛型精确匹配。
 */
import {
  tableFeatures,
  columnFilteringFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createSortedRowModel,
  createPaginatedRowModel,
} from "@tanstack/react-table";

export const dataTableFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  columnVisibilityFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
});

export type DataTableFeatures = typeof dataTableFeatures;
