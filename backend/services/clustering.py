from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import hdbscan
import numpy as np
from sklearn.cluster import AgglomerativeClustering, Birch, DBSCAN, KMeans, MiniBatchKMeans, OPTICS
from sklearn.decomposition import PCA
from sklearn.metrics import calinski_harabasz_score, davies_bouldin_score, silhouette_score
from sklearn.mixture import GaussianMixture
from sklearn.preprocessing import normalize


NOISE_LABEL = -1


@dataclass
class QualityMetrics:
    silhouette_score: float | None
    davies_bouldin_score: float | None
    calinski_harabasz_score: float | None


@dataclass
class OutlierHandlingResult:
    db_labels: list[int | None]
    metric_labels: np.ndarray
    outliers_detected: int
    outliers_dropped: int
    outliers_reassigned: int


def preprocess_embeddings(
    embeddings: np.ndarray,
    *,
    normalize_embeddings: bool,
    pca_components: int | None,
    random_state: int,
) -> tuple[np.ndarray, int | None]:
    transformed = np.asarray(embeddings, dtype=np.float32)

    if normalize_embeddings:
        transformed = normalize(transformed, norm="l2", axis=1).astype(np.float32, copy=False)

    applied_pca_components: int | None = None
    if pca_components is not None:
        max_components = min(transformed.shape[0], transformed.shape[1])
        if pca_components > max_components:
            raise ValueError(
                f"pca_components ({pca_components}) cannot exceed min(n_samples, n_features) ({max_components})."
            )
        transformed = PCA(n_components=pca_components, random_state=random_state).fit_transform(transformed)
        transformed = transformed.astype(np.float32, copy=False)
        applied_pca_components = pca_components

    return transformed, applied_pca_components


def run_clustering(
    embeddings: np.ndarray,
    *,
    algorithm: str,
    distance_metric: str,
    n_clusters: int,
    min_cluster_size: int,
    min_samples: int | None,
    eps: float,
    max_eps: float | None,
    linkage: str,
    covariance_type: str,
    birch_threshold: float,
    birch_branching_factor: int,
    random_state: int,
) -> np.ndarray:
    if algorithm == "kmeans":
        labels = KMeans(
            n_clusters=n_clusters,
            random_state=random_state,
            n_init="auto",
        ).fit_predict(embeddings)
    elif algorithm == "mini_batch_kmeans":
        labels = MiniBatchKMeans(
            n_clusters=n_clusters,
            random_state=random_state,
            n_init="auto",
            batch_size=min(1024, max(128, len(embeddings) // 10)),
        ).fit_predict(embeddings)
    elif algorithm == "agglomerative":
        labels = AgglomerativeClustering(
            n_clusters=n_clusters,
            metric=distance_metric,
            linkage=linkage,
        ).fit_predict(embeddings)
    elif algorithm == "dbscan":
        labels = DBSCAN(
            eps=eps,
            min_samples=min_samples or 5,
            metric=distance_metric,
            n_jobs=-1,
        ).fit_predict(embeddings)
    elif algorithm == "optics":
        labels = OPTICS(
            min_samples=min_samples or 5,
            max_eps=max_eps if max_eps is not None else np.inf,
            metric=distance_metric,
            cluster_method="xi",
            n_jobs=-1,
        ).fit_predict(embeddings)
    elif algorithm == "birch":
        labels = Birch(
            n_clusters=n_clusters,
            threshold=birch_threshold,
            branching_factor=birch_branching_factor,
        ).fit_predict(embeddings)
    elif algorithm == "gaussian_mixture":
        labels = GaussianMixture(
            n_components=n_clusters,
            covariance_type=covariance_type,
            random_state=random_state,
            reg_covar=1e-6,
        ).fit_predict(embeddings)
    elif algorithm == "hdbscan":
        labels = hdbscan.HDBSCAN(
            min_cluster_size=min_cluster_size,
            min_samples=min_samples,
            metric=distance_metric,
            core_dist_n_jobs=-1,
        ).fit_predict(embeddings)
    else:
        raise ValueError(f"Unsupported clustering algorithm: {algorithm}")

    return np.asarray(labels, dtype=np.int32)


def compute_quality_metrics(
    embeddings: np.ndarray,
    labels: np.ndarray,
    *,
    distance_metric: str,
) -> QualityMetrics:
    metric_embeddings = embeddings
    metric_labels = labels

    if np.any(labels == NOISE_LABEL):
        keep = labels != NOISE_LABEL
        metric_embeddings = embeddings[keep]
        metric_labels = labels[keep]

    unique_labels = np.unique(metric_labels)
    n_clusters = len(unique_labels)
    n_samples = metric_embeddings.shape[0]
    if n_clusters < 2 or n_samples <= n_clusters:
        return QualityMetrics(
            silhouette_score=None,
            davies_bouldin_score=None,
            calinski_harabasz_score=None,
        )

    silhouette: float | None
    davies_bouldin: float | None
    calinski_harabasz: float | None

    try:
        silhouette = float(
            silhouette_score(
                metric_embeddings,
                metric_labels,
                metric=distance_metric,
                sample_size=min(5000, n_samples),
            )
        )
    except Exception:
        silhouette = None

    try:
        davies_bouldin = float(davies_bouldin_score(metric_embeddings, metric_labels))
    except Exception:
        davies_bouldin = None

    try:
        calinski_harabasz = float(calinski_harabasz_score(metric_embeddings, metric_labels))
    except Exception:
        calinski_harabasz = None

    return QualityMetrics(
        silhouette_score=silhouette,
        davies_bouldin_score=davies_bouldin,
        calinski_harabasz_score=calinski_harabasz,
    )


def _compute_centroids(
    embeddings: np.ndarray,
    labels: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    unique_labels = np.unique(labels)
    centroids: list[np.ndarray] = []
    for label in unique_labels:
        cluster_points = embeddings[labels == label]
        centroids.append(cluster_points.mean(axis=0))
    return unique_labels, np.vstack(centroids)


def _pairwise_distance(
    points: np.ndarray,
    centroids: np.ndarray,
    *,
    distance_metric: Literal["euclidean", "manhattan", "cosine"],
) -> np.ndarray:
    if distance_metric == "euclidean":
        return np.linalg.norm(points[:, None, :] - centroids[None, :, :], axis=2)

    if distance_metric == "manhattan":
        return np.sum(np.abs(points[:, None, :] - centroids[None, :, :]), axis=2)

    # cosine distance = 1 - cosine similarity
    points_norm = np.linalg.norm(points, axis=1, keepdims=True)
    centroids_norm = np.linalg.norm(centroids, axis=1, keepdims=True).T
    denom = np.clip(points_norm * centroids_norm, 1e-12, None)
    similarity = (points @ centroids.T) / denom
    return 1.0 - similarity


def apply_outlier_policy(
    embeddings: np.ndarray,
    labels: np.ndarray,
    *,
    outlier_policy: Literal["keep", "drop", "nearest"],
    distance_metric: Literal["euclidean", "manhattan", "cosine"],
) -> OutlierHandlingResult:
    labels_int = np.asarray(labels, dtype=np.int32)
    outlier_mask = labels_int == NOISE_LABEL
    outliers_detected = int(np.sum(outlier_mask))

    if outliers_detected == 0 or outlier_policy == "keep":
        db_labels = [int(label) for label in labels_int]
        return OutlierHandlingResult(
            db_labels=db_labels,
            metric_labels=labels_int,
            outliers_detected=outliers_detected,
            outliers_dropped=0,
            outliers_reassigned=0,
        )

    if outlier_policy == "drop":
        db_labels = [None if label == NOISE_LABEL else int(label) for label in labels_int]
        return OutlierHandlingResult(
            db_labels=db_labels,
            metric_labels=labels_int,
            outliers_detected=outliers_detected,
            outliers_dropped=outliers_detected,
            outliers_reassigned=0,
        )

    # outlier_policy == "nearest"
    inlier_mask = ~outlier_mask
    if not np.any(inlier_mask):
        db_labels = [int(label) for label in labels_int]
        return OutlierHandlingResult(
            db_labels=db_labels,
            metric_labels=labels_int,
            outliers_detected=outliers_detected,
            outliers_dropped=0,
            outliers_reassigned=0,
        )

    inlier_labels, centroids = _compute_centroids(embeddings[inlier_mask], labels_int[inlier_mask])
    outlier_points = embeddings[outlier_mask]
    distances = _pairwise_distance(outlier_points, centroids, distance_metric=distance_metric)
    nearest_idx = np.argmin(distances, axis=1)
    reassigned_labels = inlier_labels[nearest_idx].astype(np.int32, copy=False)

    metric_labels = labels_int.copy()
    metric_labels[outlier_mask] = reassigned_labels
    db_labels = [int(label) for label in metric_labels]
    return OutlierHandlingResult(
        db_labels=db_labels,
        metric_labels=metric_labels,
        outliers_detected=outliers_detected,
        outliers_dropped=0,
        outliers_reassigned=outliers_detected,
    )
