from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field, model_validator


# ── Ingest ──────────────────────────────────────────────────────────────────


class IngestResponse(BaseModel):
    job_id: str
    status: Literal["queued", "running", "completed", "completed_with_errors", "failed", "cancelled"]
    message: str


class ValidationErrorRow(BaseModel):
    row_number: int
    reason: str
    row_data: dict[str, str]


class JobStatus(BaseModel):
    job_id: str
    status: Literal["queued", "running", "completed", "completed_with_errors", "failed", "cancelled"]
    total_rows: int
    processed_rows: int
    failed_rows: int
    validation_failed_rows: int = 0
    processing_failed_rows: int = 0
    errors: list[str]
    validation_errors_preview: list[ValidationErrorRow] = []
    has_validation_report: bool = False
    validation_report_url: str | None = None
    max_rows_requested: int = 50
    started_at: str | None
    completed_at: str | None
    cancelled_at: str | None
    phase: str = "Queued"
    eta_seconds: int | None = None
    elapsed_seconds: int = 0
    rows_per_second: float = 0


ClusterAlgorithm = Literal[
    "kmeans",
    "mini_batch_kmeans",
    "agglomerative",
    "dbscan",
    "optics",
    "birch",
    "gaussian_mixture",
    "hdbscan",
]
DistanceMetric = Literal["euclidean", "manhattan", "cosine"]
LinkageType = Literal["ward", "complete", "average", "single"]
CovarianceType = Literal["full", "tied", "diag", "spherical"]
OutlierPolicy = Literal["keep", "drop", "nearest"]
AutoTuneObjective = Literal["silhouette", "davies_bouldin", "calinski_harabasz"]

ALGORITHM_METRICS: dict[str, set[str]] = {
    "kmeans": {"euclidean"},
    "mini_batch_kmeans": {"euclidean"},
    "agglomerative": {"euclidean", "manhattan", "cosine"},
    "dbscan": {"euclidean", "manhattan", "cosine"},
    "optics": {"euclidean", "manhattan", "cosine"},
    "birch": {"euclidean"},
    "gaussian_mixture": {"euclidean"},
    "hdbscan": {"euclidean", "manhattan"},
}


# ── Cluster ─────────────────────────────────────────────────────────────────

class ClusterRequest(BaseModel):
    algorithm: ClusterAlgorithm = "kmeans"
    distance_metric: DistanceMetric = "euclidean"
    outlier_policy: OutlierPolicy = "keep"

    normalize_embeddings: bool = Field(default=False)
    pca_components: int | None = Field(default=None, ge=2, le=768)

    random_state: int = Field(default=42, ge=0, le=2_147_483_647)
    lock_random_state: bool = Field(default=True)

    # shared / k-based
    n_clusters: int = Field(default=8, ge=2, le=200)
    auto_tune_k: bool = False
    k_min: int = Field(default=2, ge=2, le=200)
    k_max: int = Field(default=12, ge=2, le=200)
    auto_tune_objective: AutoTuneObjective = "silhouette"

    # density-based
    min_cluster_size: int = Field(default=5, ge=2, le=1000)
    min_samples: int | None = Field(default=None, ge=1, le=1000)
    eps: float = Field(default=0.35, gt=0.0, le=10.0)
    max_eps: float | None = Field(default=None, gt=0.0, le=10.0)

    # hierarchical
    linkage: LinkageType = "average"

    # mixture
    covariance_type: CovarianceType = "full"

    # birch
    birch_threshold: float = Field(default=0.5, gt=0.0, le=10.0)
    birch_branching_factor: int = Field(default=50, ge=2, le=500)

    @model_validator(mode="after")
    def validate_algorithm_config(self) -> "ClusterRequest":
        supported_metrics = ALGORITHM_METRICS[self.algorithm]
        if self.distance_metric not in supported_metrics:
            raise ValueError(
                f"distance_metric '{self.distance_metric}' is not supported for algorithm '{self.algorithm}'."
            )

        if self.algorithm == "agglomerative" and self.linkage == "ward" and self.distance_metric != "euclidean":
            raise ValueError("Agglomerative with linkage='ward' only supports distance_metric='euclidean'.")

        if self.algorithm == "optics" and self.max_eps is not None and self.max_eps <= self.eps:
            raise ValueError("max_eps must be greater than eps for optics.")

        if self.k_max < self.k_min:
            raise ValueError("k_max must be greater than or equal to k_min.")

        if self.auto_tune_k:
            if self.algorithm not in {"kmeans", "mini_batch_kmeans", "agglomerative", "birch", "gaussian_mixture"}:
                raise ValueError("auto_tune_k is only supported for k-based clustering algorithms.")
            if (self.k_max - self.k_min + 1) > 40:
                raise ValueError("auto_tune_k range is too wide. Keep it to 40 k values or fewer.")

        return self


class ClusterResponse(BaseModel):
    algorithm: ClusterAlgorithm
    distance_metric: DistanceMetric
    outlier_policy: OutlierPolicy
    random_state_used: int | None
    normalize_embeddings: bool
    pca_components: int | None
    auto_tuned: bool
    auto_tune_objective: AutoTuneObjective | None
    selected_n_clusters: int | None
    n_clusters_found: int
    noise_points: int
    outliers_detected: int
    outliers_dropped: int
    outliers_reassigned: int
    silhouette_score: float | None
    davies_bouldin_score: float | None
    calinski_harabasz_score: float | None
    label_counts: dict[str, int]


# ── tSNE ────────────────────────────────────────────────────────────────────

class TsnePoint(BaseModel):
    id: int
    x: float
    y: float
    story: str
    raw_data: dict[str, str]
    cluster_label: int | None
    cluster_algorithm: ClusterAlgorithm | None
    kmeans_label: int | None
    hdbscan_label: int | None


class TsneResponse(BaseModel):
    points: list[TsnePoint]
    computed_at: str
    from_cache: bool


# ── Search ───────────────────────────────────────────────────────────────────

class SearchResult(BaseModel):
    id: int
    story: str
    raw_data: dict[str, str]
    cosine_distance: float
    similarity_score: float
    cluster_label: int | None
    cluster_algorithm: ClusterAlgorithm | None
    kmeans_label: int | None
    hdbscan_label: int | None


class SearchResponse(BaseModel):
    query: str
    results: list[SearchResult]
    total_returned: int
    embedding_latency_ms: float
