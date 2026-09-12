/**
 * 浏览器端 XHR 上传客户端（v0.6.0 G08）
 *
 * Server Actions 无法提供上传进度且不能可靠取消底层请求；这里通过同源 Route Handler
 * 使用 XMLHttpRequest，利用 upload progress 与 abort() 实现真实双向反馈。
 */
import type { ActionResult } from "@/lib/types/action-result";

export interface UploadFileRequest {
  url: string;
  fieldName: string;
  file: File;
  fields?: Record<string, string>;
  onProgress?: (percent: number) => void;
}

export interface UploadRequestHandle {
  promise: Promise<ActionResult<{ url: string }>>;
  cancel: () => void;
}

interface UploadResponsePayload {
  ok?: unknown;
  error?: unknown;
  data?: { url?: unknown };
}

function responseResult(xhr: XMLHttpRequest): ActionResult<{ url: string }> {
  const payload =
    typeof xhr.response === "object" && xhr.response !== null
      ? (xhr.response as UploadResponsePayload)
      : null;

  if (
    xhr.status >= 200 &&
    xhr.status < 300 &&
    payload?.ok === true &&
    typeof payload.data?.url === "string"
  ) {
    return { ok: true, data: { url: payload.data.url } };
  }

  const error = typeof payload?.error === "string" ? payload.error : "uploadFailed";
  return { ok: false, error };
}

/** 创建可取消的上传请求；promise 仅结算一次。 */
export function createUploadRequest({
  url,
  fieldName,
  file,
  fields,
  onProgress,
}: UploadFileRequest): UploadRequestHandle {
  const xhr = new XMLHttpRequest();
  let settled = false;

  const promise = new Promise<ActionResult<{ url: string }>>((resolve) => {
    const settle = (result: ActionResult<{ url: string }>) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    xhr.open("POST", url);
    xhr.responseType = "json";

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      const percent = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
      onProgress?.(percent);
    };
    xhr.onload = () => settle(responseResult(xhr));
    xhr.onerror = () => settle({ ok: false, error: "uploadFailed" });
    xhr.onabort = () => settle({ ok: false, error: "uploadCancelled" });

    const formData = new FormData();
    for (const [key, value] of Object.entries(fields ?? {})) formData.append(key, value);
    formData.append(fieldName, file);

    try {
      xhr.send(formData);
    } catch {
      settle({ ok: false, error: "uploadFailed" });
    }
  });

  return {
    promise,
    cancel: () => {
      if (!settled) xhr.abort();
    },
  };
}
