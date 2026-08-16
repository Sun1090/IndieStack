/**
 * useOnClickOutside — 点击外部检测 Hook
 * 检测点击是否发生在指定元素外部，常用于下拉菜单、弹窗等关闭逻辑
 *
 * @example
 * const ref = useRef(null)
 * useOnClickOutside(ref, () => setOpen(false))
 * // <div ref={ref}>下拉菜单内容</div>
 */
"use client";

export { useOnClickOutside } from "usehooks-ts";
