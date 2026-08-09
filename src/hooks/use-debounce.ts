/**
 * useDebounce — 防抖 Hook
 * 将值延迟更新，常用于搜索输入、窗口大小变化等需要限制触发频率的场景
 *
 * @example
 * const [search, setSearch] = useState("")
 * const debouncedSearch = useDebounce(search, 300)
 * useEffect(() => { api.search(debouncedSearch) }, [debouncedSearch])
 */
"use client";

import { useDebounceValue } from "usehooks-ts";

/**
 * 将 useDebounceValue 封装为 useDebounce 以保持兼容
 * useDebounceValue 返回 [debouncedValue, updateFn]，这里只取 debouncedValue
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue] = useDebounceValue(value, delay);
  return debouncedValue;
}