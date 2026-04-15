"use client";
import { useState, useEffect } from "react";
import { useSearch } from "@/hooks/useSearch";
import { resolveLeadName } from "@/lib/leads";

interface Props {
  onSelectResult: (id: number) => void;
}

function useDebounce(value: string, ms: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedValue(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debouncedValue;
}

export default function SearchBar({ onSelectResult }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const debouncedQuery = useDebounce(query, 300);
  const { data, isFetching } = useSearch(debouncedQuery);

  return (
    <div className="relative w-full max-w-none sm:max-w-xl">
      <div className="relative">
        <input
          type="text"
          placeholder="Semantic search leads…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="w-full bg-white border border-zinc-300 rounded-xl px-4 py-2 pr-10 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-500"
        />
        {isFetching && (
          <div className="absolute right-3 top-2.5">
            <div className="w-4 h-4 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {open && data && data.results.length > 0 && (
        <div className="absolute top-full mt-1 left-0 right-0 z-50 bg-white border border-zinc-200 rounded-xl shadow-lg max-h-80 overflow-y-auto">
          <div className="px-3 py-1.5 border-b border-zinc-200 text-xs text-zinc-500">
            {data.total_returned} result(s) · {data.embedding_latency_ms.toFixed(0)}ms embedding
          </div>
          {data.results.map((r) => {
            const name = resolveLeadName(r.raw_data, r.id);
            const project = r.raw_data["Project"] || "No project";
            return (
              <button
                key={r.id}
                onMouseDown={() => { onSelectResult(r.id); setOpen(false); setQuery(""); }}
                className="w-full px-3 py-2.5 text-left hover:bg-zinc-50 transition-colors border-b border-zinc-100 last:border-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium text-zinc-900">{name}</span>
                  <span className="shrink-0 text-xs font-mono text-zinc-600">{(r.similarity_score * 100).toFixed(0)}%</span>
                </div>
                <p className="mt-0.5 truncate text-xs text-zinc-500">{project}</p>
                <p className="text-xs text-zinc-500 mt-0.5 line-clamp-1">{r.story}</p>
              </button>
            );
          })}
        </div>
      )}

      {open && debouncedQuery.length >= 3 && data?.results.length === 0 && !isFetching && (
        <div className="absolute top-full mt-1 left-0 right-0 z-50 bg-white border border-zinc-200 rounded-xl px-3 py-2 text-sm text-zinc-500 shadow-lg">
          No matches found
        </div>
      )}
    </div>
  );
}
