/**
 * 登录失败的进程内计数桶。
 *
 * **这个模块刻意不带 `"use server"`。** 上一版把「清空计数桶」和两个 action 放在同一个
 * `"use server"` 文件里，于是 `clearLoginBuckets` 也是一条**可 POST 的 action**——
 * 它没有鉴权、没有身份判定，谁调到它，全站的双维度锁定就归零。
 * 当时唯一的缓冲是「没有客户端组件 import 它」（只有单测在用），
 * 而「因为没人引用所以不可达」不是授权，是一次等着被打破的默契：
 * 任何一次「顺手给运维加个清空按钮」都会把它变成公开入口。
 *
 * 所以桶的归属放在这里（普通模块，没有网络表面），
 * `src/lib/actions/login-attempts.ts` 只负责用 `headers()` 解析出维度的 key，
 * 真正面向网络的入口只有它导出的那两个。清空入口留在服务端进程内：
 * 需要清桶时重启、或在服务端代码 / 测试里调用，不需要一个 HTTP 面。
 */
import { createKeyedWindowStore } from "@/lib/rate-limit";

/** 滑窗与阈值（IP 维度阈值放宽：同一出口 IP 可能有多名用户） */
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_EMAIL_MAX_FAILURES = 5;
export const LOGIN_IP_MAX_FAILURES = 20;

export const loginEmailStore = createKeyedWindowStore({
  max: LOGIN_EMAIL_MAX_FAILURES,
  windowMs: LOGIN_WINDOW_MS,
});

export const loginIpStore = createKeyedWindowStore({
  max: LOGIN_IP_MAX_FAILURES,
  windowMs: LOGIN_WINDOW_MS,
});

/** 测试/运维：清空计数桶（**不是** Server Action，没有网络表面） */
export function clearLoginBuckets(): void {
  loginEmailStore.clear();
  loginIpStore.clear();
}
