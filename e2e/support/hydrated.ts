/**
 * 与 hydration 抢跑的通用解法（v0.12.0 E2E 稳定性）。
 *
 * 服务端渲染的按钮在 HTML 到达时就 `toBeVisible()`，但它的 `onClick` 要等 React hydration
 * 才挂得上。用例若按「等可见 → 点一次 → 等结果」写，在慢机器上就会把那次 click 丢进空气里，
 * 然后一直等到用例超时——`e2e/account-deletion.spec.ts` 就是这样间歇红的（`input.fill()`
 * 卡在 60s，报错是「waiting for getByRole('textbox')」，而同一份代码在隔壁用例里就过了）。
 *
 * 关键是：重试的必须是**整个「先看结果、缺了才动」的判断**，不是只重试断言。
 * 只重试断言的话，动作在第二次可能把状态又翻回去、或者留下重复提交；
 * 这里动作只在结果缺席时重放，所以成功的那一次不会被演第二遍。
 */
import { expect, type Locator } from "@playwright/test";

/**
 * 反复执行 `act()`（仅在 `result` 还没出现时），直到 `result` 可见。
 *
 * @param act 触发客户端状态变化的动作：click / press，返回 Promise 以便串行等待
 * @param result 动作生效的可观察结果；它必须只在「已生效」时存在
 */
export async function actUntilVisible(
  act: () => Promise<unknown>,
  result: Locator,
  options?: { timeout?: number },
): Promise<void> {
  await expect(async () => {
    if (!(await result.isVisible())) await act();
    await expect(result).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: options?.timeout ?? 20_000, intervals: [500, 1_000] });
}
