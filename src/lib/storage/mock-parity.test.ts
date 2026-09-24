/**
 * Mock storage 表面与真实驱动的对账测试。
 *
 * 起因不是推测：E2E 跑注入失败的上传用例时，服务端日志里有
 * `TypeError: createAdminClient(...).storage.from(...).remove is not a function`。
 * `src/lib/storage/index.test.ts` 里那份手搓替身**是带 `remove` 的**，
 * 所以驱动的单测一直绿，而 mock 模式下真正的回滚路径从来没跑通过。
 * 这个文件钉的就是「驱动会调到的那几个方法，mock 客户端必须也有」。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createMockSupabaseClient,
  getMockUploadFailNext,
  setMockUploadFailNext,
} from "@/lib/mock";
import { getStorageDriver } from "./index";

/** 当前配置下（公共读 bucket）驱动真的会打到 storage API 的方法。 */
const DRIVEN_METHODS = ["upload", "getPublicUrl", "remove"] as const;

/**
 * `createMockSupabaseClient()` 返回的是具体类，`storage.from()` 的表面本来就带类型；
 * 只有「按名字问方法在不在」那一条需要把它当字典看。
 */
function bucket() {
  return createMockSupabaseClient().storage.from("avatars");
}

describe("mock storage 与驱动的表面一致", () => {
  beforeEach(() => setMockUploadFailNext(0));
  afterEach(() => setMockUploadFailNext(0));

  it("驱动要调的三个方法 mock 都得有（缺一个就红在这里）", () => {
    const surface = bucket() as unknown as Record<string, unknown>;
    const missing = DRIVEN_METHODS.filter((name) => typeof surface[name] !== "function");
    expect(missing).toEqual([]);
  });

  it("remove 返回 supabase-js 的形状，让回滚路径真的能跑完", async () => {
    const client = bucket();
    const uploaded = await client.upload("avatars/u1/k.png", Buffer.from("x"), {
      contentType: "image/png",
    });
    expect(uploaded).toMatchObject({ data: { path: "avatars/u1/k.png" }, error: null });

    const removed = await client.remove(["avatars/u1/k.png"]);
    expect(removed.error).toBeNull();
    expect(removed.data).toEqual([
      { path: "avatars/u1/k.png", bucket_id: "avatars", id: "avatars/avatars/u1/k.png" },
    ]);
  });

  it("回滚不计入上传失败注入，否则注入 N 次的用例语义会被改变", async () => {
    // 注入 2 而不是 1：只留 1 次的话上传就把它吃光了，回滚看到的预算本来就是 0，
    // 「回滚也吃预算」这个变异在这种 setup 下根本测不出来（第一版就是这样漏的）。
    setMockUploadFailNext(2);
    const client = bucket();
    const failed = await client.upload("avatars/u1/k.png", Buffer.from("x"));
    expect(failed.data).toBeNull();
    expect(failed.error).toBeTruthy();
    expect(getMockUploadFailNext()).toBe(1);

    // 预算还剩 1 的时候回滚必须成功：它是「把那个没写成的对象删掉」，不是一次新的上传。
    const removed = await client.remove(["avatars/u1/k.png"]);
    expect(removed.error).toBeNull();
    expect(getMockUploadFailNext()).toBe(1);
  });

  it("驱动侧走同一个对象：cleanupStorageObject 不再被 TypeError 咽掉", async () => {
    // 这里不换替身：驱动拿到的就是 createAdminClient() 在 mock 模式下返回的那个客户端。
    const driver = getStorageDriver();
    await expect(driver.remove("avatars/u1/k.png")).resolves.toBeUndefined();
  });
});
