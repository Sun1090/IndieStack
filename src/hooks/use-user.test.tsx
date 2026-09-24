/**
 * useUser 的两路写入契约测试
 * 这个 hook 同时被两个来源写：一次性的 `getUser()`（发起那一刻的会话快照）
 * 与 `onAuthStateChange` 的实时推送。契约是「推上来的那份较新，快照不得回头盖它」。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import type { Session, User } from "@supabase/supabase-js";
import { useUser } from "./use-user";

const getUserMock = vi.hoisted(() => vi.fn());
const unsubscribeMock = vi.hoisted(() => vi.fn());
// 订阅回调由被测代码在挂载时注册，这里把它接出来，好在用例子内部控制「什么时候推」。
const holder = vi.hoisted(() => ({
  push: null as null | ((event: string, session: Session | null) => void),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: getUserMock,
      onAuthStateChange: (cb: (event: string, session: Session | null) => void) => {
        holder.push = cb;
        return { data: { subscription: { unsubscribe: unsubscribeMock } } };
      },
    },
  }),
}));

function Probe() {
  const { user, loading } = useUser();
  return <span>{loading ? "loading" : user ? `user:${user.id}` : "anon"}</span>;
}

const alice = { id: "alice" } as User;
const aliceSession = { user: alice } as Session;

/** 挂起一次 getUser，把 resolve 交到用例手上，用来安排「谁先谁后」。 */
function deferredGetUser() {
  let resolve: ((v: { data: { user: User | null } }) => void) | null = null;
  getUserMock.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  return () => resolve?.({ data: { user: alice } });
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useUser", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    unsubscribeMock.mockReset();
    holder.push = null;
  });

  it("快照读取先回来时正常给出用户", async () => {
    getUserMock.mockResolvedValue({ data: { user: alice } });
    render(<Probe />);
    await settle();
    expect(screen.getByText("user:alice").textContent).toBe("user:alice");
  });

  it("订阅报「已退出」之后，迟到的快照回执不许把人写回去", async () => {
    const resolveGetUser = deferredGetUser();
    render(<Probe />);
    expect(screen.getByText("loading").textContent).toBe("loading");

    await act(async () => {
      holder.push?.("SIGNED_OUT", null);
    });
    expect(screen.getByText("anon").textContent).toBe("anon");

    await act(async () => {
      resolveGetUser();
      await Promise.resolve();
    });
    expect(screen.getByText("anon").textContent).toBe("anon");
  });

  it("订阅推上来的会话就是最终答案", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    render(<Probe />);
    await settle();
    expect(screen.getByText("anon").textContent).toBe("anon");
    await act(async () => {
      holder.push?.("SIGNED_IN", aliceSession);
    });
    expect(screen.getByText("user:alice").textContent).toBe("user:alice");
  });

  it("卸载时退订", async () => {
    getUserMock.mockResolvedValue({ data: { user: alice } });
    const view = render(<Probe />);
    await settle();
    view.unmount();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });
});
