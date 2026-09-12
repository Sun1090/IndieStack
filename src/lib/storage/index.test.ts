/**
 * storage 抽象层单测（v0.5.0 B01）
 * 覆盖：驱动选择（OSS 配置门控）、对象键构造（白名单扩展名/防穿越）、Supabase 驱动上传
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { createAdminClientMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
const { ossStoreMock } = vi.hoisted(() => ({
  ossStoreMock: {
    put: vi.fn(async () => ({ url: "https://oss.example/k" })),
    signatureUrl: vi.fn(() => "https://oss.example/signed"),
    delete: vi.fn(async () => ({})),
  },
}));
vi.mock("ali-oss", () => ({
  default: class MockOSS {
    put = ossStoreMock.put;
    signatureUrl = ossStoreMock.signatureUrl;
    delete = ossStoreMock.delete;
  },
}));

import {
  getStorageDriver,
  buildObjectKey,
  isOssConfigured,
  ALLOWED_IMAGE_TYPES,
  AVATAR_MAX_BYTES,
  SIGNED_URL_MAX_SECONDS,
  cleanupStorageObject,
  cleanupManagedStorageUrl,
} from "./index";

const OSS_ENV = {
  OSS_BUCKET: "bucket",
  OSS_REGION: "oss-cn-hangzhou",
  OSS_ACCESS_KEY_ID: "id",
  OSS_ACCESS_KEY_SECRET: "secret",
};

function setOssEnv(env: Record<string, string>) {
  for (const k of Object.keys(OSS_ENV)) {
    if (env[k]) process.env[k] = env[k];
    else delete process.env[k];
  }
}

afterEach(() => setOssEnv({}));

describe("isOssConfigured()", () => {
  it("四项环境变量齐备才启用 OSS", () => {
    setOssEnv({});
    expect(isOssConfigured()).toBe(false);
    setOssEnv({ ...OSS_ENV, OSS_ACCESS_KEY_SECRET: "" });
    expect(isOssConfigured()).toBe(false);
    setOssEnv(OSS_ENV);
    expect(isOssConfigured()).toBe(true);
  });
});

describe("getStorageDriver()", () => {
  beforeEach(() => setOssEnv({}));

  it("OSS 配置不完整时明确回退 Supabase，能力集合保持一致", () => {
    setOssEnv({ OSS_BUCKET: "bucket", OSS_REGION: "region" });
    const driver = getStorageDriver();
    expect(driver.provider).toBe("supabase");
    expect(driver.capabilities).toEqual({
      put: true,
      publicUrl: true,
      signedUrl: true,
      remove: true,
    });
  });

  it("默认回退 Supabase 驱动：上传成功返回公共 URL", async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const getPublicUrl = vi.fn(() => ({ data: { publicUrl: "https://cdn.example/m1.png" } }));
    createAdminClientMock.mockReturnValue({
      storage: {
        from: vi.fn(() => ({ upload, getPublicUrl, createSignedUrl: vi.fn(), remove: vi.fn() })),
      },
    });

    const driver = getStorageDriver();
    const url = await driver.put("avatars/u1/k.png", Buffer.from("x"), "image/png");
    expect(url).toBe("https://cdn.example/m1.png");
    expect(upload).toHaveBeenCalledWith(
      "avatars/u1/k.png",
      expect.any(Buffer),
      expect.objectContaining({ contentType: "image/png" }),
    );
  });

  it("暴露 provider 能力并支持签名 URL与删除", async () => {
    const createSignedUrl = vi.fn(async () => ({
      data: { signedUrl: "https://signed.example" },
      error: null,
    }));
    const remove = vi.fn(async () => ({ error: null }));
    createAdminClientMock.mockReturnValue({
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(async () => ({ error: null })),
          getPublicUrl: vi.fn(() => ({ data: { publicUrl: "https://public.example" } })),
          createSignedUrl,
          remove,
        })),
      },
    });
    const driver = getStorageDriver();
    expect(driver.provider).toBe("supabase");
    expect(driver.capabilities).toEqual({
      put: true,
      publicUrl: true,
      signedUrl: true,
      remove: true,
    });
    await expect(driver.signedUrl("k", 300)).resolves.toBe("https://signed.example");
    await driver.remove("k");
    expect(createSignedUrl).toHaveBeenCalledWith("k", 300);
    expect(remove).toHaveBeenCalledWith(["k"]);
  });

  it("签名 URL 过期时间限制在 1 秒至 7 天", async () => {
    createAdminClientMock.mockReturnValue({
      storage: {
        from: vi.fn(() => ({
          createSignedUrl: vi.fn(async () => ({
            data: { signedUrl: "https://signed" },
            error: null,
          })),
        })),
      },
    });
    const driver = getStorageDriver();
    await expect(driver.signedUrl("k", 0)).rejects.toThrow("invalid signed URL expiry");
    await expect(driver.signedUrl("k", SIGNED_URL_MAX_SECONDS + 1)).rejects.toThrow(
      "invalid signed URL expiry",
    );
    await expect(driver.signedUrl("k", 60.5)).rejects.toThrow("invalid signed URL expiry");
  });

  it("Supabase 签名 URL与删除失败会保留错误上下文", async () => {
    const createSignedUrl = vi.fn(async () => ({ data: null, error: { message: "sign failed" } }));
    const remove = vi.fn(async () => ({ error: { message: "remove failed" } }));
    createAdminClientMock.mockReturnValue({
      storage: { from: vi.fn(() => ({ createSignedUrl, remove })) },
    });
    const driver = getStorageDriver();
    await expect(driver.signedUrl("k", 60)).rejects.toThrow("sign failed");
    await expect(driver.remove("k")).rejects.toThrow("remove failed");
  });

  it("Supabase 上传失败抛错", async () => {
    createAdminClientMock.mockReturnValue({
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(async () => ({ error: { message: "bucket missing" } })),
        })),
      },
    });
    await expect(getStorageDriver().put("k.png", Buffer.from("x"), "image/png")).rejects.toThrow(
      "bucket missing",
    );
  });

  it("OSS 配置齐备时切换 OSS 驱动并支持签名 URL与删除", async () => {
    setOssEnv(OSS_ENV);
    const driver = getStorageDriver();
    expect(driver.provider).toBe("oss");
    expect(driver.capabilities.signedUrl).toBe(true);
    await expect(driver.put("k", Buffer.from("x"), "image/png")).resolves.toBe(
      "https://oss.example/k",
    );
    await expect(driver.signedUrl("k", 300)).resolves.toBe("https://oss.example/signed");
    await driver.remove("k");
    expect(ossStoreMock.signatureUrl).toHaveBeenCalledWith("k", { expires: 300 });
    expect(ossStoreMock.delete).toHaveBeenCalledWith("k");
  });
});

describe("buildObjectKey()", () => {
  it("扩展名取自白名单映射，键含前缀/用户/随机串", () => {
    const key = buildObjectKey("avatars", "u1", "image/png");
    expect(key).toMatch(/^avatars\/u1\/\d+-[0-9a-f]{16}\.png$/);
  });

  it("白名单覆盖三类图片", () => {
    expect(Object.keys(ALLOWED_IMAGE_TYPES).sort()).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
    expect(AVATAR_MAX_BYTES).toBe(2 * 1024 * 1024);
  });

  it("未支持类型直接拒绝（杜绝任意后缀与路径穿越）", () => {
    expect(() => buildObjectKey("avatars", "u1", "application/pdf")).toThrow("unsupported");
    expect(() => buildObjectKey("avatars", "u1", "../../evil")).toThrow("unsupported");
  });

  it("拒绝跨租户路径段与非法 prefix", () => {
    expect(() => buildObjectKey("../covers", "u1", "image/png")).toThrow("invalid storage prefix");
    expect(() => buildObjectKey("avatars", "../other-user", "image/png")).toThrow(
      "invalid storage tenant",
    );
    expect(() => buildObjectKey("avatars", "", "image/png")).toThrow("invalid storage tenant");
  });
});

describe("extractManagedObjectKey()", () => {
  it("解析 Supabase 与 OSS 受管 URL", async () => {
    const { extractManagedObjectKey } = await import("./index");
    expect(
      extractManagedObjectKey(
        "https://x.supabase.co/storage/v1/object/public/avatars/avatars/u1/a.png",
        "avatars",
        "u1",
      ),
    ).toBe("avatars/u1/a.png");
    expect(
      extractManagedObjectKey("https://bucket.oss.example/covers/p1/a.webp", "covers", "p1"),
    ).toBe("covers/p1/a.webp");
  });

  it("拒绝其他租户、路径穿越与非法 URL", async () => {
    const { extractManagedObjectKey } = await import("./index");
    expect(
      extractManagedObjectKey("https://cdn.example/avatars/u2/a.png", "avatars", "u1"),
    ).toBeNull();
    expect(
      extractManagedObjectKey("https://cdn.example/avatars/u1/%2e%2e/secret", "avatars", "u1"),
    ).toBeNull();
    expect(extractManagedObjectKey("javascript:alert(1)", "avatars", "u1")).toBeNull();
  });
});

describe("storage cleanup helpers", () => {
  let remove: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setOssEnv({});
    remove = vi.fn(async () => ({ error: null }));
    createAdminClientMock.mockClear();
    createAdminClientMock.mockReturnValue({
      storage: {
        from: vi.fn(() => ({ remove })),
      },
    });
  });

  it("成功清理受管对象并返回 true", async () => {
    await expect(
      cleanupStorageObject("avatars/u1/old.png", { operation: "test", resourceId: "u1" }),
    ).resolves.toBe(true);
    expect(remove).toHaveBeenCalledWith(["avatars/u1/old.png"]);
  });

  it("拒绝危险 key 且不触发 provider", async () => {
    await expect(
      cleanupStorageObject("../secret", { operation: "test", resourceId: "u1" }),
    ).resolves.toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it("provider 删除失败时返回 false 而不抛出", async () => {
    const remove = vi.fn(async () => ({ error: { message: "provider unavailable" } }));
    createAdminClientMock.mockReturnValue({ storage: { from: vi.fn(() => ({ remove })) } });
    await expect(
      cleanupStorageObject("avatars/u1/old.png", { operation: "test", resourceId: "u1" }),
    ).resolves.toBe(false);
  });

  it("仅清理匹配租户的 URL", async () => {
    await expect(
      cleanupManagedStorageUrl("https://cdn.example/avatars/u1/old.png", "avatars", "u1", {
        operation: "test",
        resourceId: "u1",
      }),
    ).resolves.toBe(true);
    await expect(
      cleanupManagedStorageUrl("https://cdn.example/avatars/u2/old.png", "avatars", "u1", {
        operation: "test",
        resourceId: "u1",
      }),
    ).resolves.toBe(false);
  });
});
