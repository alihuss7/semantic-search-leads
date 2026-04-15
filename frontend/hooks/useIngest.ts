"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import type { IngestRequest } from "@/lib/types";

export function useIngest() {
  const [jobId, setJobId] = useState<string | null>(null);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: (req: IngestRequest) => api.ingest(req),
    onMutate: () => setJobId(null),
    onSuccess: (data) => setJobId(data.job_id),
  });

  const statusQuery = useQuery({
    queryKey: ["ingestStatus", jobId],
    queryFn: () => api.ingestStatus(jobId!),
    enabled: !!jobId,
    retry: 3,
    refetchInterval: (query) => {
      if (query.state.error) {
        return false;
      }
      const status = query.state.data?.status;
      if (status === "completed" || status === "completed_with_errors" || status === "failed" || status === "cancelled") {
        return false;
      }
      return 2000;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.cancelIngest(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ingestStatus", jobId] });
    },
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => api.retryIngest(id),
    onSuccess: (data) => {
      setJobId(data.job_id);
      qc.invalidateQueries({ queryKey: ["ingestStatus", data.job_id] });
    },
  });

  return {
    mutation,
    statusQuery,
    cancelMutation,
    retryMutation,
    jobId,
    clearJob: () => {
      qc.removeQueries({ queryKey: ["ingestStatus", jobId] });
      setJobId(null);
      mutation.reset();
    },
  };
}
