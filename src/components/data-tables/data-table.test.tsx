/**
 * DataTable 通用表格组件测试
 * 覆盖：渲染、搜索过滤、空数据态、加载态、行点击、分页
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataTable } from "./data-table";
import type { ColumnDef } from "@tanstack/react-table";

type Row = { id: number; name: string; role: string };

const columns: ColumnDef<Row>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "role", header: "Role" },
];

const data: Row[] = Array.from({ length: 12 }, (_, i) => ({
  id: i,
  name: `user-${i}`,
  role: i % 2 === 0 ? "admin" : "member",
}));

describe("DataTable", () => {
  it("渲染表头与数据行", () => {
    render(<DataTable columns={columns} data={data.slice(0, 3)} />);
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("user-0")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(4); // 表头 + 3 行
  });

  it("搜索过滤命中行", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={data} searchKey="name" />);
    await user.type(screen.getByPlaceholderText("搜索..."), "user-1");
    expect(screen.getByText("user-1")).toBeInTheDocument();
    expect(screen.queryByText("user-0")).not.toBeInTheDocument();
  });

  it("空数据显示占位提示", () => {
    render(<DataTable columns={columns} data={[]} emptyText="没有结果" />);
    expect(screen.getByText("没有结果")).toBeInTheDocument();
  });

  it("loading 状态显示加载中", () => {
    render(<DataTable columns={columns} data={[]} loading />);
    expect(screen.getByText("加载中...")).toBeInTheDocument();
  });

  it("行点击触发回调", async () => {
    const onRowClick = vi.fn();
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={[{ id: 1, name: "alice", role: "admin" }]} onRowClick={onRowClick} />);

    await user.click(screen.getByText("alice"));
    expect(onRowClick).toHaveBeenCalledWith({ id: 1, name: "alice", role: "admin" });
  });

  it("超过 pageSize 时渲染分页并可翻页", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={data} pageSize={10} />);

    // 第一页不含第 11 条
    expect(screen.queryByText("user-11")).not.toBeInTheDocument();
    // 分页信息可见
    expect(screen.getByText(/共 12 条/)).toBeInTheDocument();
    // 点下一页后出现
    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByText("user-11")).toBeInTheDocument();
    expect(screen.queryByText("user-0")).not.toBeInTheDocument();
  });
});
