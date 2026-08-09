/**
 * SearchInput 搜索输入框组件
 * ======================
 *
 * 带防抖的搜索输入框，自动延迟触发 onChange 回调。
 * 支持清除按钮、加载状态、自定义图标。
 *
 * 使用方式：
 *   <SearchInput
 *     value={query}
 *     onChange={setQuery}
 *     placeholder="搜索项目..."
 *   />
 */

"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Search, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchInputProps {
  /** 当前搜索值 */
  value: string;
  /** 值变更回调（已防抖） */
  onChange: (value: string) => void;
  /** 防抖延迟（毫秒，默认 300） */
  debounceMs?: number;
  /** 占位文本 */
  placeholder?: string;
  /** 是否显示加载状态 */
  isLoading?: boolean;
  /** 额外的 CSS 类名 */
  className?: string;
  /** 是否禁用 */
  disabled?: boolean;
}

export function SearchInput({
  value: externalValue,
  onChange,
  debounceMs = 300,
  placeholder = "搜索...",
  isLoading = false,
  className,
  disabled = false,
}: SearchInputProps) {
  const [localValue, setLocalValue] = useState(externalValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 外部 value 变化时同步
  useEffect(() => {
    setLocalValue(externalValue);
  }, [externalValue]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      setLocalValue(newValue);

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(() => {
        onChange(newValue);
      }, debounceMs);
    },
    [onChange, debounceMs]
  );

  const handleClear = useCallback(() => {
    setLocalValue("");
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    onChange("");
  }, [onChange]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return (
    <div className={cn("relative", className)}>
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={localValue}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        className="pl-9 pr-9"
      />
      <div className="absolute right-3 top-1/2 -translate-y-1/2">
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : localValue ? (
          <button
            type="button"
            onClick={handleClear}
            className="text-muted-foreground hover:text-foreground transition-colors"
            disabled={disabled}
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
