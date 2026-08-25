"use client";

/**
 * FAQ 分类列表（客户端搜索过滤）
 */

import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

interface FaqQuestion {
  q: string;
  a: string;
}

interface FaqCategory {
  name: string;
  questions: FaqQuestion[];
}

export function FaqList({ categories }: { categories: FaqCategory[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories
      .map((cat) => ({
        ...cat,
        questions: cat.questions.filter(
          (item) =>
            item.q.toLowerCase().includes(q) || item.a.toLowerCase().includes(q),
        ),
      }))
      .filter((cat) => cat.questions.length > 0);
  }, [categories, query]);

  const totalResults = filtered.reduce((sum, c) => sum + c.questions.length, 0);

  return (
    <>
      {/* 搜索框 */}
      <div className="mx-auto mt-8 max-w-md relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={search_placeholder()}
          aria-label={search_placeholder()}
          className="h-10 w-full rounded-lg border bg-background pl-9 pr-4 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="mx-auto mt-16 max-w-3xl space-y-12">
        {totalResults === 0 ? (
          <p className="py-12 text-center text-muted-foreground">{no_results()}</p>
        ) : (
          filtered.map((category) => (
            <div key={category.name}>
              <h2 className="mb-6 text-2xl font-bold">{category.name}</h2>
              <div className="space-y-3">
                {category.questions.map((item) => (
                  <details
                    key={item.q}
                    className="group rounded-lg border bg-card transition-colors hover:border-primary/50"
                  >
                    <summary className="flex cursor-pointer items-center justify-between p-4 text-sm font-medium">
                      {item.q}
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="border-t px-4 py-3 text-sm text-muted-foreground">{item.a}</div>
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

function search_placeholder() {
  return "Search FAQ...";
}
function no_results() {
  return "No matching questions found.";
}
