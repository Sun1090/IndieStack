/**
 * API 响应工具
 * 鉴权作用域的动态数据禁止缓存，统一通过 jsonNoStore 输出
 */
import { NextResponse } from "next/server";

export function jsonNoStore<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
  });
}
