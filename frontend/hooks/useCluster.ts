"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ClusterRequest } from "@/lib/types";

export function useCluster() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: ClusterRequest) => api.cluster(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tsne"] });
    },
  });
}
