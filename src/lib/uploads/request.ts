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

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BODY_BYTES) {
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
  invalidInput: 400,
  rateLimited: 429,
  uploadCancelled: 408,
  uploadFailed: 500,
};

export function uploadErrorStatus(error: string): number {
  return ERROR_STATUS[error] ?? 500;
}

export function uploadResultResponse(result: UploadResult) {
  return jsonNoStore(result, { status: result.ok ? 200 : uploadErrorStatus(result.error) });
}
