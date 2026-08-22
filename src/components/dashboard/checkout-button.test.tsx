/**
 * CheckoutButton 组件测试
 * 覆盖：渲染、结账成功跳转、接口失败 toast
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CheckoutButton } from "./checkout-button";

// next-intl：t 直接返回 key，便于断言
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({
  toast: toastMock,
}));

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchMock);

// jsdom 不支持导航，用可写 stub 替换 window.location
const locationStub = { href: "" };
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: locationStub,
  });
  locationStub.href = "";
});

describe("CheckoutButton", () => {
  it("渲染传入的 label", () => {
    render(<CheckoutButton priceId="price_123" label="升级 Pro" />);
    expect(screen.getByRole("button", { name: "升级 Pro" })).toBeInTheDocument();
  });

  it("结账成功后跳转到 Stripe URL", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://checkout.stripe.com/session" }),
    });

    const user = userEvent.setup();
    render(<CheckoutButton priceId="price_123" label="升级 Pro" />);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(locationStub.href).toBe("https://checkout.stripe.com/session");
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priceId: "price_123" }),
    });
  });

  it("接口返回错误时展示 destructive toast 且不跳转", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "paymentFailed" }),
    });

    const user = userEvent.setup();
    render(<CheckoutButton priceId="price_123" label="升级 Pro" />);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      );
    });
    expect(locationStub.href).toBe("");
    expect(screen.getByRole("button")).toBeEnabled();
  });

  it("网络异常时展示 destructive toast", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    const user = userEvent.setup();
    render(<CheckoutButton priceId="price_123" label="升级 Pro" />);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      );
    });
  });
});
