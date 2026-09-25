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

/**
 * 链上的过滤谓词全集。对账「多处走同一段过滤」的测试要用它，而不是自己抄一份方法名——
 * 抄的那份会漏：队列谓词加上 `.is("email_skipped_reason", null)` 那天，
 * 只比 `eq/in/or` 的对账用例对第三段完全无感，删掉一处也照样全绿。
 */
export const CHAIN_FILTER_METHODS = ["eq", "gt", "gte", "lt", "lte", "neq", "is", "in", "or"] as const;

/** 不是过滤条件、因而不参与「同一段过滤」对账的链方法。 */
const CHAIN_OTHER_METHODS = [
  "select",
  "order",
  "limit",
  "range",
  "update",
  "insert",
  "upsert",
  "delete",
] as const;

/** 链式查询 mock：await chain → outcome；.single()/.maybeSingle() → Promise<outcome> */
export function chainMock(outcome: ChainOutcome = {}) {
  const full = { data: null, error: null, count: null, ...outcome };
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  for (const m of [...CHAIN_FILTER_METHODS, ...CHAIN_OTHER_METHODS]) {
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
    gt: boom,
    gte: boom,
    lt: boom,
    lte: boom,
    neq: boom,
    is: boom,
    delete: boom,
    in: boom,
    or: boom,
    single: () => Promise.reject(err),
    maybeSingle: () => Promise.reject(err),
  };
}

/** { from(table) } 客户端 mock */
export function dbClientMock(impl: (table: string) => unknown) {
  return { from: vi.fn(impl) };
}
