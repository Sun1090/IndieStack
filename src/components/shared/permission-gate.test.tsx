/**
 * PermissionGate 角色解析测试
 * 覆盖：读到角色时正常放行；profile 查询报错 / 没有行 / 抛异常时一律退回最低权限，
 * 与 usePermissions 给出同一个答案
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PermissionGate, usePermissions } from "./permission-gate";

const getUserMock = vi.hoisted(() => vi.fn());
const singleMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: getUserMock },
    from: () => ({ select: () => ({ eq: () => ({ single: singleMock }) }) }),
  }),
}));

function Probe() {
  const p = usePermissions();
  return (
    <span>
      {p.role ?? "null"}|{String(p.can("user:write"))}|{String(p.isAtLeast("member"))}
    </span>
  );
}

describe("PermissionGate", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    singleMock.mockReset();
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } } });
  });

  function renderGate() {
    return render(
      <PermissionGate requirePermission="user:write" fallback={<span>blocked</span>}>
        <span>panel</span>
      </PermissionGate>,
    );
  }

  it("member 有 user:write，正常放行", async () => {
    singleMock.mockResolvedValue({ data: { role: "member" }, error: null });
    renderGate();
    await waitFor(() => expect(screen.getByText("panel")).toBeInTheDocument());
    expect(screen.queryByText("blocked")).toBeNull();
  });

  it("查询报错时不放行，哪怕 data 里写着 member", async () => {
    singleMock.mockResolvedValue({
      data: { role: "member" },
      error: { message: "connection timeout" },
    });
    renderGate();
    await waitFor(() => expect(screen.getByText("blocked")).toBeInTheDocument());
    expect(screen.queryByText("panel")).toBeNull();
  });

  it("没有 profile 行（PGRST116）时不放行", async () => {
    singleMock.mockResolvedValue({
      data: null,
      error: { message: "JSON object requested, multiple (or no) rows returned" },
    });
    renderGate();
    await waitFor(() => expect(screen.getByText("blocked")).toBeInTheDocument());
  });

  it("抛异常时不放行", async () => {
    singleMock.mockRejectedValue(new Error("network"));
    renderGate();
    await waitFor(() => expect(screen.getByText("blocked")).toBeInTheDocument());
  });

  it("未登录直接 viewer，不去查 profile", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    renderGate();
    await waitFor(() => expect(screen.getByText("blocked")).toBeInTheDocument());
    expect(singleMock).not.toHaveBeenCalled();
  });
});

describe("usePermissions", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    singleMock.mockReset();
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } } });
  });

  it("读到 member 时给出 50 档", async () => {
    singleMock.mockResolvedValue({ data: { role: "member" }, error: null });
    render(<Probe />);
    await waitFor(() => expect(screen.getByText("member|true|true")).toBeInTheDocument());
  });

  it("读不出答案时与 PermissionGate 同一次查询失败给出同一个地板", async () => {
    singleMock.mockResolvedValue({ data: { role: "member" }, error: { message: "boom" } });
    render(<Probe />);
    await waitFor(() => expect(screen.getByText("viewer|false|false")).toBeInTheDocument());
  });
});
