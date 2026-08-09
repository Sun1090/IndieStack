/**
 * useCopyToClipboard — 剪贴板复制 Hook
 * 提供复制文本到剪贴板的功能和复制状态
 *
 * @example
 * const { copy, copied } = useCopyToClipboard()
 * <button onClick={() => copy("hello")}>{copied ? "已复制" : "复制"}</button>
 */
"use client";

export { useCopyToClipboard } from "usehooks-ts";