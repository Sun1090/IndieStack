"use client";

/**
 * FAQ 分类列表（客户端搜索过滤）
 */

import { useMemo, useState } from "react";
import { ChevronDown, Search, SearchX } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";

interface FaqQuestion {
  q: string;
  a: string;
}

interface FaqCategory {
  name: string;
  questions: FaqQuestion[];
}

export function FaqList({
  categories,
  searchPlaceholder,
  noResults,
}: {
  categories: FaqCategory[];
  searchPlaceholder: string;
  noResults: string;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories
      .map((cat) => ({
        ...cat,
        questions: cat.questions.filter(
          (item) => item.q.toLowerCase().includes(q) || item.a.toLowerCase().includes(q),
        ),
      }))
      .filter((cat) => cat.questions.length > 0);
  }, [categories, query]);

  const totalResults = filtered.reduce((sum, c) => sum + c.questions.length, 0);

  return (
    <>
      {/* 搜索框 */}
      <div className="relative mx-auto mt-8 max-w-md">
        <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="bg-background focus:ring-ring h-10 w-full rounded-lg border pr-4 pl-9 text-sm outline-hidden focus:ring-2"
        />
      </div>

      <div className="mx-auto mt-16 max-w-3xl space-y-12">
        {totalResults === 0 ? (
          <EmptyState icon={SearchX} title={noResults} />
        ) : (
          filtered.map((category) => (
            <div key={category.name}>
              <h2 className="mb-6 text-2xl font-bold">{category.name}</h2>
              <div className="space-y-3">
                {category.questions.map((item) => (
                  <details
                    key={item.q}
                    className="group bg-card hover:border-primary/50 rounded-lg border transition-colors"
                  >
                    <summary className="flex cursor-pointer items-center justify-between p-4 text-sm font-medium">
                      {item.q}
                      <ChevronDown className="text-muted-foreground h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="text-muted-foreground border-t px-4 py-3 text-sm">{item.a}</div>
                  </details>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
