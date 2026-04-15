import type {
  IngestRequest, IngestResponse, JobStatus,
  ClusterRequest, ClusterResponse,
  TsneResponse,
  SearchResponse,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  const body = init?.body;
  if (body != null && !(body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${BASE}${path}`, {
    headers,
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  ingest: ({ file, max_rows }: IngestRequest = {}) => {
    const normalizedMaxRows =
      typeof max_rows === "number" && Number.isFinite(max_rows) && max_rows > 0
        ? Math.floor(max_rows)
        : 50;

    if (!file) {
      return apiFetch<IngestResponse>(`/ingest?max_rows=${normalizedMaxRows}`, { method: "POST" });
    }

    const form = new FormData();
    form.append("file", file);
    form.append("max_rows", String(normalizedMaxRows));
    return apiFetch<IngestResponse>("/ingest", { method: "POST", body: form });
  },

  ingestStatus: (jobId: string) =>
    apiFetch<JobStatus>(`/ingest/${jobId}/status`),

  cancelIngest: (jobId: string) =>
    apiFetch<IngestResponse>(`/ingest/${jobId}/cancel`, { method: "POST" }),

  retryIngest: (jobId: string) =>
    apiFetch<IngestResponse>(`/ingest/${jobId}/retry`, { method: "POST" }),

  validationReportUrl: (jobId: string) =>
    `${BASE}/ingest/${jobId}/validation-report.csv`,

  cluster: (body: ClusterRequest) =>
    apiFetch<ClusterResponse>("/cluster", { method: "POST", body: JSON.stringify(body) }),

  tsne: (recompute = false, perplexity = 30, n_iter = 1000) =>
    apiFetch<TsneResponse>(`/tsne?recompute=${recompute}&perplexity=${perplexity}&n_iter=${n_iter}`),

  search: (q: string, limit = 10, threshold = 0.3) =>
    apiFetch<SearchResponse>(`/search?q=${encodeURIComponent(q)}&limit=${limit}&threshold=${threshold}`),
};
