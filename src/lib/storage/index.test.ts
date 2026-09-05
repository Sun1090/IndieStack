/**
 * storage 抽象层单测（v0.5.0 B01）
 * 覆盖：驱动选择（OSS 配置门控）、对象键构造（白名单扩展名/防穿越）、Supabase 驱动上传
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { createAdminClientMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import {
  getStorageDriver,
  buildObjectKey,
  isOssConfigured,
  ALLOWED_IMAGE_TYPES,
  AVATAR_MAX_BYTES,
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

  it("默认回退 Supabase 驱动：上传成功返回公共 URL", async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const getPublicUrl = vi.fn(() => ({ data: { publicUrl: "https://cdn.example/m1.png" } }));
    createAdminClientMock.mockReturnValue({
      storage: { from: vi.fn(() => ({ upload, getPublicUrl })) },
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

  it("Supabase 上传失败抛错", async () => {
    createAdminClientMock.mockReturnValue({
      storage: {
        from: vi.fn(() => ({ upload: vi.fn(async () => ({ error: { message: "bucket missing" } })) })),
      },
    });
    await expect(getStorageDriver().put("k.png", Buffer.from("x"), "image/png")).rejects.toThrow(
      "bucket missing",
    );
  });

  it("OSS 配置齐备时切换 OSS 驱动（依赖动态加载）", () => {
    setOssEnv(OSS_ENV);
    const driver = getStorageDriver();
    expect(typeof driver.put).toBe("function");
  });
});

describe("buildObjectKey()", () => {
  it("扩展名取自白名单映射，键含前缀/用户/随机串", () => {
    const key = buildObjectKey("avatars", "u1", "image/png");
    expect(key).toMatch(/^avatars\/u1\/\d+-[0-9a-f]{16}\.png$/);
  });

  it("白名单覆盖三类图片", () => {
    expect(Object.keys(ALLOWED_IMAGE_TYPES).sort()).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(AVATAR_MAX_BYTES).toBe(2 * 1024 * 1024);
  });

  it("未支持类型直接拒绝（杜绝任意后缀与路径穿越）", () => {
    expect(() => buildObjectKey("avatars", "u1", "application/pdf")).toThrow("unsupported");
    expect(() => buildObjectKey("avatars", "u1", "../../evil")).toThrow("unsupported");
  });
});
