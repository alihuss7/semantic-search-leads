"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useTsne(enabled: boolean, perplexity = 30, n_iter = 1000) {
  const qc = useQueryClient();
  const queryKey = ["tsne", perplexity, n_iter] as const;

  const query = useQuery({
    queryKey,
    queryFn: () => api.tsne(false, perplexity, n_iter),
    enabled,
    staleTime: Infinity,
    retry: false,
  });

  const recomputeMutation = useMutation({
    mutationFn: () => api.tsne(true, perplexity, n_iter),
    onSuccess: (data) => {
      qc.setQueryData(queryKey, data);
    },
  });

  return {
    ...query,
    recomputeTsne: recomputeMutation.mutate,
    isRecomputing: recomputeMutation.isPending,
  };
}
