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
 *
 * 提交类动作（点 submit）不套这个：它的「结果」原生提交也能造出来，判据得换成
 * 「应用收到了那次请求」——见下面的 `actUntilServerAction`。
 */
import { expect, type Locator, type Page, type Request } from "@playwright/test";

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

/** 一轮里等那次提交发出的时间：等的是**请求发出**，不是响应回来。 */
const REQUEST_ROUND_TIMEOUT = 3_000;

/** Server Action 请求的指纹。原生表单提交没有 `next-action`，所以两者分得开。 */
function isServerAction(request: Request): boolean {
  return request.method() === "POST" && request.headers()["next-action"] !== undefined;
}

/**
 * 统计这个页面上出现过的 Server Action 请求。判据只放一处：
 * 「应用收到了这次提交」只能看请求头，不能看页面变成什么样——原生提交也能把字段清空。
 */
export function watchServerActions(page: Page): { count: () => number; stop: () => void } {
  let seen = 0;
  const listener = (request: Request): void => {
    if (isServerAction(request)) seen += 1;
  };
  page.on("request", listener);
  return { count: () => seen, stop: () => page.off("request", listener) };
}

/**
 * 提交类动作（`<form onSubmit>` 里的 submit）专用：反复重放，直到应用真的收到一次 Server Action。
 *
 * 为什么不能套 `actUntilVisible`：提交的可观察结果常常在**原生提交**里也出现。实测过一次
 * `/contact`——hydration 之前点提交，浏览器自己完成这次提交并重新渲染页面，于是「输入框被清空」
 * 这个成功标志照样绿，而应用从头到尾没收到请求（表单改成 `method="post"` 之后仍然如此，
 * 只是字段值不再进 URL）。判据必须换成「请求真的发出去了」。
 *
 * 为什么不会重复提交：每轮先看计数有没有增加，只有**没增加**（说明上一次点击被吞）才重放。
 * 剩下的唯一窗口是「点击已生效，但请求在 3s 内没出现在网络层」——那已经是应用自己的问题，
 * 报错也会指在那里，而不是被悄悄重试掉。
 *
 * `act` 必须是**可重放的一轮完整动作**：上一次点击可能已经被浏览器当成原生提交消费掉了，
 * 页面因此重新渲染成空表单——只重放 `click()` 会被字段自己的 `required` 校验挡死，
 * 屏障会一直重试到最后超时（第一版就是这么卡的）。填写和点击要一起放进 `act`。
 *
 * @returns 观测到的 Server Action 请求数（用例可据此断言「恰好一次」）
 */
export async function actUntilServerAction(
  page: Page,
  act: () => Promise<unknown>,
  options?: { timeout?: number },
): Promise<number> {
  const watched = watchServerActions(page);
  try {
    await expect(async () => {
      const before = watched.count();
      await act();
      await expect
        .poll(() => watched.count(), { timeout: REQUEST_ROUND_TIMEOUT, intervals: [100] })
        .toBeGreaterThan(before);
    }).toPass({ timeout: options?.timeout ?? 20_000, intervals: [500, 1_000] });
  } finally {
    watched.stop();
  }
  return watched.count();
}
