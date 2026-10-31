/**
 * 上传 HTTP 请求边界（v0.6.0 G08）
 * 只处理同源/限流/请求体大小与错误状态映射，不复制领域规则。
 */
import { NextResponse, type NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { AVATAR_MAX_BYTES } from "@/lib/storage";
import type { UploadResult } from "./service";

/** multipart 头部/边界余量；文件本身仍由 service 严格要求 ≤2MB。 */
export const MAX_UPLOAD_BODY_BYTES = AVATAR_MAX_BYTES + 1024 * 1024;

export type UploadRequestGuard =
  { ok: true; formData: FormData } | { ok: false; response: NextResponse };

function sameOrigin(request: Pick<NextRequest, "headers" | "url">): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

/** 统一拒绝跨站、缺少 Origin、超额请求体、畸形 multipart 与触发限流的请求。 */
export async function guardUploadRequest(request: NextRequest): Promise<UploadRequestGuard> {
  if (!sameOrigin(request)) {
    return { ok: false, response: jsonNoStore({ ok: false, error: "forbidden" }, { status: 403 }) };
  }

  const limits = await rateLimit.check(request);
  if (!limits.allowed) {
    return {
      ok: false,
      response: jsonNoStore(
        { ok: false, error: "rateLimited", retryAfter: Math.ceil(limits.resetIn / 1000) },
        { status: 429, headers: { "Retry-After": String(Math.ceil(limits.resetIn / 1000)) } },
      ),
    };
  }

  /**
   * **先要一个可信的长度，再去读 body。**
   *
   * 这里原来写的是 `Number(request.headers.get("content-length"))`——头不存在时
   * `Number(null)` 是 **0**，`Number.isFinite(0)` 为真且 0 不大于上限，于是这道守卫
   * 对「不带 Content-Length 的请求」是**静默放行**的，紧接着的 `request.formData()`
   * 会把整个 body 读进内存。触发方式很普通：`Transfer-Encoding: chunked` 的 multipart
   * POST，Origin 头由调用方自己填一个同源值（这道检查挡的是浏览器跨站，不挡 curl）。
   *
   * 为什么「缺长度就拒绝」是可接受的口径：这两个端点只服务浏览器表单，
   * `fetch(url, { body: new FormData() })` 与 `curl -F` 都必然带长度；
   * 真正会缺的是手工构造的流式请求——而那正是这条守卫要挡的形状。
   * 状态码用 **411**（Length Required）而不是 413：语义是「你没给长度」，
   * 不是「你的文件太大」，混淆两者会让调用方以为是自己的文件问题。
   *
   * **仍然存在的边界（不夸大）**：Vercel 有 4.5MB 平台上限兜底，而仓库自带的
   * Dockerfile 自托管构型**没有**——所以这道守卫在自托管上是真实的防线，
   * 不是一条只在平台上重复做的事。
   */
  const rawLength = request.headers.get("content-length");
  // 空串也要按「没给」处理：`Number("")` 同样是 0，与 `Number(null)` 一样会静默通过。
  const declaredLength =
    rawLength === null || rawLength.trim() === "" ? Number.NaN : Number(rawLength);
  if (!Number.isFinite(declaredLength) || declaredLength < 0) {
    return {
      ok: false,
      response: jsonNoStore({ ok: false, error: "lengthRequired" }, { status: 411 }),
    };
  }
  if (declaredLength > MAX_UPLOAD_BODY_BYTES) {
    return {
      ok: false,
      response: jsonNoStore({ ok: false, error: "fileTooLarge" }, { status: 413 }),
    };
  }

  try {
    return { ok: true, formData: await request.formData() };
  } catch {
    return {
      ok: false,
      response: jsonNoStore({ ok: false, error: "invalidInput" }, { status: 400 }),
    };
  }
}

const ERROR_STATUS: Record<string, number> = {
  notAuthenticated: 401,
  forbidden: 403,
  onlyAdminsCreateProject: 403,
  projectNotFound: 404,
  fileRequired: 400,
  fileTypeUnsupported: 400,
  fileTooLarge: 413,
  // 请求没带 Content-Length：见 `guardUploadRequest` 里那段「先要长度再读 body」。
  lengthRequired: 411,
  invalidInput: 400,
  rateLimited: 429,
  uploadCancelled: 408,
  uploadFailed: 500,
  // 授权判定所需的那一行读不到：不是「没权限」也不是「项目不存在」，是一次可重试的故障。
  uploadUnavailable: 503,
};

export function uploadErrorStatus(error: string): number {
  return ERROR_STATUS[error] ?? 500;
}

export function uploadResultResponse(result: UploadResult) {
  return jsonNoStore(result, { status: result.ok ? 200 : uploadErrorStatus(result.error) });
}
