"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useSearch(query: string, limit = 10) {
  return useQuery({
    queryKey: ["search", query, limit],
    queryFn: () => api.search(query, limit),
    enabled: query.trim().length >= 3,
    staleTime: 30_000,
  });
}
