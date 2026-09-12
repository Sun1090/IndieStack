/**
 * NotificationsLive component tests (v0.6.0 G09)
 * Locks the postgres_changes contract, refresh coalescing, status fallback and cleanup.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationsLive } from "./notifications-live";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const mocks = vi.hoisted(() => {
  let onChange: (() => void) | undefined;
  let onStatus: ((status: string) => void) | undefined;
  const channel = {
    on: vi.fn(
      (_type: string, _filter: unknown, callback: () => void): typeof channel => {
        onChange = callback;
        return channel;
      },
    ),
    subscribe: vi.fn((callback?: (status: string) => void): typeof channel => {
      onStatus = callback;
      return channel;
    }),
    unsubscribe: vi.fn(() => Promise.resolve("ok")),
  };
  const supabase = {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(() => Promise.resolve("ok")),
  };
  const createClient = vi.fn(() => supabase);
  const router = { refresh: vi.fn() };
  return {
    router,
    channel,
    supabase,
    createClient,
    getOnChange: () => onChange,
    getOnStatus: () => onStatus,
  };
});

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/lib/supabase/client", () => ({ createClient: mocks.createClient }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockImplementation(() => mocks.supabase);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("NotificationsLive", () => {
  it("订阅当前用户的 postgres_changes INSERT，并合并刷新", () => {
    vi.useFakeTimers();
    const { unmount } = render(<NotificationsLive userId="user-1" />);

    expect(mocks.supabase.channel).toHaveBeenCalledWith("notifications:user-1");
    expect(mocks.channel.on).toHaveBeenCalledWith(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: "user_id=eq.user-1",
      },
      expect.any(Function),
    );
    expect(screen.getByRole("status")).toHaveTextContent("connecting");

    act(() => mocks.getOnStatus()?.("SUBSCRIBED"));
    expect(screen.getByRole("status")).toHaveTextContent("live");

    act(() => {
      mocks.getOnChange()?.();
      mocks.getOnChange()?.();
      vi.advanceTimersByTime(119);
    });
    expect(mocks.router.refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(mocks.router.refresh).toHaveBeenCalledTimes(1);

    unmount();
    expect(mocks.supabase.removeChannel).toHaveBeenCalledWith(mocks.channel);
  });

  it("连接失败时显示离线状态但不影响页面", async () => {
    render(<NotificationsLive userId="user-1" />);

    act(() => mocks.getOnStatus()?.("CHANNEL_ERROR"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("offline"));
  });

  it("客户端初始化异常时安全降级", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.createClient.mockImplementationOnce(() => {
      throw new Error("missing env");
    });

    render(<NotificationsLive userId="user-1" />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("offline"));
    expect(warn).toHaveBeenCalledWith(
      "[NotificationsLive] Realtime 订阅初始化失败，已安全降级:",
      expect.any(Error),
    );
    warn.mockRestore();
  });
});
