/**
 * 通用数据表格组件
 * 基于 @tanstack/react-table v9 原生 API（显式 features 声明），支持全局搜索、排序、分页、行点击
 *
 * 使用方式：
 *   import { DataTable } from "@/components/data-tables"
 *   import { columns } from "./columns"
 *
 *   <DataTable
 *     columns={columns}
 *     data={data}
 *     searchKey="name"        // 可选：启用搜索
 *     pageSize={10}           // 可选：每页条数
 *     onRowClick={(row) => ...}  // 可选：行点击回调
 *   />
 */

"use client";

import * as React from "react";
import { flexRender, useTable, type ColumnDef } from "@tanstack/react-table";
import { dataTableFeatures } from "./features";
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Search,
  SlidersHorizontal,
  Eye,
  EyeOff,
  Loader2,
} from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// =========================================================================
// 类型定义
// =========================================================================

export interface DataTableProps<TData extends Record<string, unknown>> {
  /** 列定义（使用 @tanstack/react-table 的 ColumnDef） */
  columns: ColumnDef<typeof dataTableFeatures, TData>[];
  /** 表格数据 */
  data: TData[];
  /** 可选：启用搜索，指定要搜索的字段 key */
  searchKey?: string;
  /** 可选：搜索占位文本 */
  searchPlaceholder?: string;
  /** 可选：每页条数，默认 10 */
  pageSize?: number;
  /** 可选：每页条数选项 */
  pageSizeOptions?: number[];
  /** 可选：行点击回调 */
  onRowClick?: (row: TData) => void;
  /** 可选：是否加载中 */
  loading?: boolean;
  /** 可选：空数据提示文本 */
  emptyText?: string;
  /** 可选：是否隐藏分页 */
  hidePagination?: boolean;
  /** 可选：是否隐藏列可见性切换 */
  hideColumnToggle?: boolean;
  /** 可选：额外类名 */
  className?: string;
  /** 可选：顶部工具栏额外内容 */
  toolbarActions?: React.ReactNode;
}

// =========================================================================
// 分页按钮组件
// =========================================================================

interface PaginationButtonProps {
  onClick: () => void;
  disabled: boolean;
  icon: React.ReactNode;
  label: string;
}

function PaginationButton({ onClick, disabled, icon, label }: PaginationButtonProps) {
  return (
    <Button
      variant="outline"
      size="icon"
      className="h-8 w-8"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
    >
      {icon}
    </Button>
  );
}

// =========================================================================
// 排序表头组件
// =========================================================================

interface SortableHeaderProps {
  label: string;
  sortDirection: false | "asc" | "desc";
  onToggle: () => void;
  className?: string;
}

export function SortableHeader({ label, sortDirection, onToggle, className }: SortableHeaderProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("-ml-3 h-8 data-[state=open]:bg-accent", className)}
      onClick={onToggle}
    >
      <span>{label}</span>
      <ArrowUpDown className="ml-2 h-3.5 w-3.5 text-muted-foreground/60" />
    </Button>
  );
}

// =========================================================================
// 主 DataTable 组件
// =========================================================================

export function DataTable<TData extends Record<string, unknown>>({
  columns,
  data,
  searchKey,
  searchPlaceholder,
  pageSize = 10,
  pageSizeOptions = [10, 20, 30, 50],
  onRowClick,
  loading = false,
  emptyText,
  hidePagination = false,
  hideColumnToggle = false,
  className,
  toolbarActions,
}: DataTableProps<TData>) {
  // 状态
  const [sorting, setSorting] = React.useState<{ id: string; desc: boolean }[]>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<Record<string, boolean>>({});
  const [globalFilter, setGlobalFilter] = React.useState("");

  // 表格实例（v9：features/行模型经 dataTableFeatures 注册；受控 state 与 v8 写法一致）
  const table = useTable({
    features: dataTableFeatures,
    data,
    columns,
    state: {
      sorting,
      globalFilter,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    initialState: {
      pagination: { pageIndex: 0, pageSize },
    },
  });

  // 计算统计信息
  const totalRows = data.length;
  const filteredRows = table.getFilteredRowModel().rows.length;
  const { pageIndex, pageSize: currentPageSize } = table.state.pagination;
  const pageCount = table.getPageCount();
  const startRow = pageIndex * currentPageSize + 1;
  const endRow = Math.min((pageIndex + 1) * currentPageSize, filteredRows);

  return (
    <div className={cn("space-y-4", className)}>
      {/* 工具栏 */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-1 items-center gap-2">
          {searchKey && (
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={searchPlaceholder ?? "搜索..."}
                value={globalFilter}
                onChange={(e) => {
                  setGlobalFilter(e.target.value);
                  table.setPageIndex(0);
                }}
                className="h-9 pl-8"
              />
            </div>
          )}
          {toolbarActions}
        </div>

        <div className="flex items-center gap-2">
          {!hideColumnToggle && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9">
                  <SlidersHorizontal className="mr-2 h-3.5 w-3.5" />列
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {table
                  .getAllColumns()
                  .filter((col) => col.getCanHide())
                  .map((col) => (
                    <DropdownMenuCheckboxItem
                      key={col.id}
                      checked={col.getIsVisible()}
                      onCheckedChange={(value) => col.toggleVisibility(!!value)}
                    >
                      {(col.columnDef.header as string) ?? col.id}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* 表格主体 */}
      <div className="relative rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-32 text-center">
                  <div className="flex items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>加载中...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}

                  className={cn(onRowClick && "cursor-pointer hover:bg-muted/50")}
                  onClick={() => onRowClick?.(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-32 text-center">
                  <div className="flex flex-col items-center justify-center gap-1 text-muted-foreground">
                    <EyeOff className="h-8 w-8 opacity-40" />
                    <p className="text-sm">{emptyText ?? "暂无数据"}</p>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* 分页 */}
      {!hidePagination && filteredRows > pageSize && (
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>
              共 {filteredRows} 条，当前 {startRow}-{endRow}
            </span>
            <span className="text-muted-foreground/50">|</span>
            <span>每页</span>
            <Select
              value={String(currentPageSize)}
              onValueChange={(value) => {
                table.setPageSize(Number(value));
              }}
            >
              <SelectTrigger className="h-8 w-16">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((size: number) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span>条</span>
          </div>

          <div className="flex items-center gap-1">
            <PaginationButton
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
              icon={<ChevronsLeft className="h-4 w-4" />}
              label="首页"
            />
            <PaginationButton
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              icon={<ChevronLeft className="h-4 w-4" />}
              label="上一页"
            />
            <div className="flex items-center gap-1 px-2">
              {Array.from({ length: Math.min(pageCount, 7) }, (_, i) => {
                let pageNum: number;
                if (pageCount <= 7) {
                  pageNum = i + 1;
                } else if (pageIndex < 3) {
                  pageNum = i + 1;
                } else if (pageIndex > pageCount - 4) {
                  pageNum = pageCount - 6 + i;
                } else {
                  pageNum = pageIndex - 2 + i;
                }
                return (
                  <Button
                    key={pageNum}
                    variant={pageIndex === pageNum - 1 ? "default" : "outline"}
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => table.setPageIndex(pageNum - 1)}
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>
            <PaginationButton
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              icon={<ChevronRight className="h-4 w-4" />}
              label="下一页"
            />
            <PaginationButton
              onClick={() => table.setPageIndex(pageCount - 1)}
              disabled={!table.getCanNextPage()}
              icon={<ChevronsRight className="h-4 w-4" />}
              label="末页"
            />
          </div>
        </div>
      )}
    </div>
  );
}
