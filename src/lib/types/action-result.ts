/**
 * Server Actions 统一返回类型
 *
 * 约定：所有 Action 返回判别联合 Result，以 ok 字段区分成功/失败，
 * 失败时 error 为 i18n 错误键（客户端经 ta(error) 翻译）。
 *
 * 迁移策略：渐进式——新 Action 必须使用；存量 Action 在触碰时迁移。
 */

/** 成功结果（可携带数据） */
export interface ActionSuccess<TData = undefined> {
  ok: true;
  data?: TData;
}

/** 失败结果（error 为 i18n 键） */
export interface ActionFailure {
  ok: false;
  error: string;
}

/** Action 统一返回类型 */
export type ActionResult<TData = undefined> = ActionSuccess<TData> | ActionFailure;

/** 构造工具 */
export const ok = <TData>(data?: TData): ActionSuccess<TData> =>
  (data === undefined ? { ok: true } : { ok: true, data }) as ActionSuccess<TData>;
export const fail = (error: string): ActionFailure => ({ ok: false, error });
