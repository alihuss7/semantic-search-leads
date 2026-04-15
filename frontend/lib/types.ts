/*
 * AUTO-GENERATED FILE. DO NOT EDIT.
 * Source: backend FastAPI OpenAPI schema
 * Regenerate with: python3 backend/scripts/generate_frontend_types.py
 */

// Frontend helper request shape
export interface IngestRequest {
  file?: File | null;
  max_rows?: number;
}

export type IngestStatus = "queued" | "running" | "completed" | "completed_with_errors" | "failed" | "cancelled";
export type ClusterAlgorithm = "kmeans" | "mini_batch_kmeans" | "agglomerative" | "dbscan" | "optics" | "birch" | "gaussian_mixture" | "hdbscan";
export type DistanceMetric = "euclidean" | "manhattan" | "cosine";
export type LinkageType = "ward" | "complete" | "average" | "single";
export type CovarianceType = "full" | "tied" | "diag" | "spherical";
export type OutlierPolicy = "keep" | "drop" | "nearest";
export type AutoTuneObjective = "silhouette" | "davies_bouldin" | "calinski_harabasz";

export interface IngestResponse {
  job_id: string;
  status: "queued" | "running" | "completed" | "completed_with_errors" | "failed" | "cancelled";
  message: string;
}

export interface ValidationErrorRow {
  row_number: number;
  reason: string;
  row_data: Record<string, string>;
}

export interface JobStatus {
  job_id: string;
  status: "queued" | "running" | "completed" | "completed_with_errors" | "failed" | "cancelled";
  total_rows: number;
  processed_rows: number;
  failed_rows: number;
  validation_failed_rows?: number;
  processing_failed_rows?: number;
  errors: Array<string>;
  validation_errors_preview?: Array<ValidationErrorRow>;
  has_validation_report?: boolean;
  validation_report_url?: string | null;
  max_rows_requested?: number;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  phase?: string;
  eta_seconds?: number | null;
  elapsed_seconds?: number;
  rows_per_second?: number;
}

export interface ClusterRequest {
  algorithm?: "kmeans" | "mini_batch_kmeans" | "agglomerative" | "dbscan" | "optics" | "birch" | "gaussian_mixture" | "hdbscan";
  distance_metric?: "euclidean" | "manhattan" | "cosine";
  outlier_policy?: "keep" | "drop" | "nearest";
  normalize_embeddings?: boolean;
  pca_components?: number | null;
  random_state?: number;
  lock_random_state?: boolean;
  n_clusters?: number;
  auto_tune_k?: boolean;
  k_min?: number;
  k_max?: number;
  auto_tune_objective?: "silhouette" | "davies_bouldin" | "calinski_harabasz";
  min_cluster_size?: number;
  min_samples?: number | null;
  eps?: number;
  max_eps?: number | null;
  linkage?: "ward" | "complete" | "average" | "single";
  covariance_type?: "full" | "tied" | "diag" | "spherical";
  birch_threshold?: number;
  birch_branching_factor?: number;
}

export interface ClusterResponse {
  algorithm: "kmeans" | "mini_batch_kmeans" | "agglomerative" | "dbscan" | "optics" | "birch" | "gaussian_mixture" | "hdbscan";
  distance_metric: "euclidean" | "manhattan" | "cosine";
  outlier_policy: "keep" | "drop" | "nearest";
  random_state_used: number | null;
  normalize_embeddings: boolean;
  pca_components: number | null;
  auto_tuned: boolean;
  auto_tune_objective: "silhouette" | "davies_bouldin" | "calinski_harabasz" | null;
  selected_n_clusters: number | null;
  n_clusters_found: number;
  noise_points: number;
  outliers_detected: number;
  outliers_dropped: number;
  outliers_reassigned: number;
  silhouette_score: number | null;
  davies_bouldin_score: number | null;
  calinski_harabasz_score: number | null;
  label_counts: Record<string, number>;
}

export interface TsnePoint {
  id: number;
  x: number;
  y: number;
  story: string;
  raw_data: Record<string, string>;
  cluster_label: number | null;
  cluster_algorithm: "kmeans" | "mini_batch_kmeans" | "agglomerative" | "dbscan" | "optics" | "birch" | "gaussian_mixture" | "hdbscan" | null;
  kmeans_label: number | null;
  hdbscan_label: number | null;
}

export interface TsneResponse {
  points: Array<TsnePoint>;
  computed_at: string;
  from_cache: boolean;
}

export interface SearchResult {
  id: number;
  story: string;
  raw_data: Record<string, string>;
  cosine_distance: number;
  similarity_score: number;
  cluster_label: number | null;
  cluster_algorithm: "kmeans" | "mini_batch_kmeans" | "agglomerative" | "dbscan" | "optics" | "birch" | "gaussian_mixture" | "hdbscan" | null;
  kmeans_label: number | null;
  hdbscan_label: number | null;
}

export interface SearchResponse {
  query: string;
  results: Array<SearchResult>;
  total_returned: number;
  embedding_latency_ms: number;
}
