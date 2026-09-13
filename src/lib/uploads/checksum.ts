/**
 * 上传对象内容哈希（v0.6.0 H02）
 *
 * `public.upload_objects.checksum` 需要一个稳定的内容指纹：
 * 同一个对象键被写入不同字节时（重放、篡改、provider 侧替换）能够被发现。
 * 计算必须基于**实际读到的字节**，而不是浏览器声明的 MIME 或文件名——
 * 后者完全由客户端控制，`hasSupportedImageSignature` 校验的就是前者。
 */
import { createHash } from "node:crypto";

/** 返回小写十六进制 sha256（64 字符），与 `upload_objects.checksum` 的 check 约束一致。 */
export function imageChecksum(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}
