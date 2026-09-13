/** 上传内容哈希单测（H02）：稳定、形状与真实字节绑定。 */
import { describe, expect, it } from "vitest";
import { imageChecksum } from "./checksum";

describe("imageChecksum", () => {
  it("输出 64 位小写十六进制 sha256", () => {
    const digest = imageChecksum(Buffer.from("indiestack"));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("对同一字节稳定、对不同字节敏感", () => {
    expect(imageChecksum(Buffer.from([1, 2, 3]))).toBe(imageChecksum(Buffer.from([1, 2, 3])));
    expect(imageChecksum(Buffer.from([1, 2, 3]))).not.toBe(imageChecksum(Buffer.from([1, 2, 4])));
  });

  it("与 node:crypto 的 sha256 一致（可被运维工具独立复算）", async () => {
    const { createHash } = await import("node:crypto");
    const body = Buffer.from("RIFF0000WEBP");
    expect(imageChecksum(body)).toBe(createHash("sha256").update(body).digest("hex"));
  });
});
