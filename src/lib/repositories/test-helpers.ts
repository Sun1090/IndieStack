/**
 * Repository 层单测共享 fixture（B01）
 * 提供 Supabase 查询链 mock：所有 builder 方法返回自身，await 直接 resolve 设定结果。
 * 各 repo 测试只需 mock 对应 client 模块并用 dbClientMock 注入 from() 实现。
 */
import { vi } from "vitest";

export interface ChainOutcome {
  data?: unknown;
  error?: { message: string } | null;
  count?: number | null;
}

/** 链式查询 mock：await chain → outcome；.single()/.maybeSingle() → Promise<outcome> */
export function chainMock(outcome: ChainOutcome = {}) {
  const full = { data: null, error: null, count: null, ...outcome };
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "range", "update", "insert", "upsert", "is", "delete"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve(full));
  chain.maybeSingle = vi.fn(() => Promise.resolve(full));
  // thenable：await chain 即 resolve
  (chain as Record<string, unknown>).then = (resolve: (v: unknown) => unknown) =>
    resolve(full);
  return chain;
}

/** 同步抛错的链（模拟驱动层异常） */
export function chainThrow(err: Error) {
  const boom = () => {
    throw err;
  };
  return {
    select: boom,
    eq: boom,
    order: boom,
    limit: boom,
    range: boom,
    update: boom,
    insert: boom,
    upsert: boom,
    is: boom,
    delete: boom,
    single: () => Promise.reject(err),
    maybeSingle: () => Promise.reject(err),
  };
}

/** { from(table) } 客户端 mock */
export function dbClientMock(impl: (table: string) => unknown) {
  return { from: vi.fn(impl) };
}
