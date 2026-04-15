import numpy as np
from collections import Counter
import secrets
from typing import Literal

from fastapi import APIRouter, HTTPException
from sqlalchemy import bindparam, select

from database import AsyncSessionLocal, engine
from models import Lead
from schemas import ClusterRequest, ClusterResponse
from services.clustering import (
    NOISE_LABEL,
    QualityMetrics,
    apply_outlier_policy,
    compute_quality_metrics,
    preprocess_embeddings,
    run_clustering,
)

router = APIRouter(tags=["cluster"])
K_BASED_ALGORITHMS = {"kmeans", "mini_batch_kmeans", "agglomerative", "birch", "gaussian_mixture"}
ObjectiveName = Literal["silhouette", "davies_bouldin", "calinski_harabasz"]


def _objective_value(metrics: QualityMetrics, objective: ObjectiveName) -> float | None:
    if objective == "silhouette":
        return metrics.silhouette_score
    if objective == "davies_bouldin":
        return metrics.davies_bouldin_score
    return metrics.calinski_harabasz_score


def _is_better_objective(candidate: float, current: float | None, objective: ObjectiveName) -> bool:
    if current is None:
        return True
    if objective == "davies_bouldin":
        return candidate < current
    return candidate > current


@router.post("/cluster", response_model=ClusterResponse)
async def cluster_leads(req: ClusterRequest):
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Lead.id, Lead.embedding).where(Lead.embedding.isnot(None))
        )
        rows = result.all()

    if len(rows) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 leads with embeddings to cluster.")

    ids = [r.id for r in rows]
    embeddings = np.array([r.embedding for r in rows], dtype=np.float32)

    if req.algorithm in K_BASED_ALGORITHMS:
        req.n_clusters = min(req.n_clusters, len(rows))

    if req.algorithm == "hdbscan":
        req.min_cluster_size = min(req.min_cluster_size, len(rows))

    random_state_used = req.random_state if req.lock_random_state else secrets.randbelow(2_147_483_647)

    try:
        clustering_input, applied_pca_components = preprocess_embeddings(
            embeddings,
            normalize_embeddings=req.normalize_embeddings,
            pca_components=req.pca_components,
            random_state=random_state_used,
        )

        def run_once(n_clusters: int) -> tuple[np.ndarray, QualityMetrics, list[int | None], int, int, int]:
            raw_labels = run_clustering(
                clustering_input,
                algorithm=req.algorithm,
                distance_metric=req.distance_metric,
                n_clusters=n_clusters,
                min_cluster_size=req.min_cluster_size,
                min_samples=req.min_samples,
                eps=req.eps,
                max_eps=req.max_eps,
                linkage=req.linkage,
                covariance_type=req.covariance_type,
                birch_threshold=req.birch_threshold,
                birch_branching_factor=req.birch_branching_factor,
                random_state=random_state_used,
            )
            outlier_result = apply_outlier_policy(
                clustering_input,
                raw_labels,
                outlier_policy=req.outlier_policy,
                distance_metric=req.distance_metric,
            )
            quality = compute_quality_metrics(
                clustering_input,
                outlier_result.metric_labels,
                distance_metric=req.distance_metric,
            )
            return (
                outlier_result.metric_labels,
                quality,
                outlier_result.db_labels,
                outlier_result.outliers_detected,
                outlier_result.outliers_dropped,
                outlier_result.outliers_reassigned,
            )

        auto_tuned = False
        selected_n_clusters = req.n_clusters if req.algorithm in K_BASED_ALGORITHMS else None

        if req.auto_tune_k:
            auto_tuned = True
            k_min = req.k_min
            k_max = min(req.k_max, len(rows))
            if k_max < k_min:
                raise ValueError("No valid k values available for auto_tune_k after applying dataset size limits.")

            best_obj: float | None = None
            best_result: tuple[np.ndarray, QualityMetrics, list[int | None], int, int, int] | None = None
            best_k: int | None = None
            fallback_result: tuple[np.ndarray, QualityMetrics, list[int | None], int, int, int] | None = None
            fallback_k: int | None = None

            for k in range(k_min, k_max + 1):
                result_for_k = run_once(k)
                if fallback_result is None:
                    fallback_result = result_for_k
                    fallback_k = k
                quality_for_k = result_for_k[1]
                objective_value = _objective_value(quality_for_k, req.auto_tune_objective)
                if objective_value is None:
                    continue
                if _is_better_objective(objective_value, best_obj, req.auto_tune_objective):
                    best_obj = objective_value
                    best_result = result_for_k
                    best_k = k

            if best_result is not None and best_k is not None:
                labels, quality, db_labels, outliers_detected, outliers_dropped, outliers_reassigned = best_result
                selected_n_clusters = best_k
            elif fallback_result is not None and fallback_k is not None:
                labels, quality, db_labels, outliers_detected, outliers_dropped, outliers_reassigned = fallback_result
                selected_n_clusters = fallback_k
            else:
                raise ValueError("auto_tune_k could not find a valid clustering configuration.")
        else:
            labels, quality, db_labels, outliers_detected, outliers_dropped, outliers_reassigned = run_once(req.n_clusters)

    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Clustering failed for algorithm '{req.algorithm}': {exc}",
        ) from exc

    leads_table = Lead.__table__
    update_stmt = (
        leads_table.update()
        .where(leads_table.c.id == bindparam("lead_id"))
        .values(
            cluster_label=bindparam("cluster_label"),
            cluster_algorithm=bindparam("cluster_algorithm"),
            kmeans_label=bindparam("kmeans_label"),
            hdbscan_label=bindparam("hdbscan_label"),
        )
    )
    update_rows = [
        {
            "lead_id": lead_id,
            "cluster_label": label,
            "cluster_algorithm": req.algorithm,
            "kmeans_label": int(label) if req.algorithm == "kmeans" and label is not None else None,
            "hdbscan_label": int(label) if req.algorithm == "hdbscan" and label is not None else None,
        }
        for lead_id, label in zip(ids, db_labels)
    ]

    async with engine.begin() as conn:
        await conn.execute(update_stmt, update_rows)

    assigned_labels = [int(label) for label in db_labels if label is not None]
    label_counts = {str(k): v for k, v in Counter(assigned_labels).items()}
    noise_points = int(sum(1 for label in assigned_labels if label == NOISE_LABEL))
    unique_labels = {label for label in assigned_labels if label != NOISE_LABEL}

    return ClusterResponse(
        algorithm=req.algorithm,
        distance_metric=req.distance_metric,
        outlier_policy=req.outlier_policy,
        random_state_used=random_state_used,
        normalize_embeddings=req.normalize_embeddings,
        pca_components=applied_pca_components,
        auto_tuned=auto_tuned,
        auto_tune_objective=req.auto_tune_objective if req.auto_tune_k else None,
        selected_n_clusters=selected_n_clusters,
        n_clusters_found=len(unique_labels),
        noise_points=noise_points,
        outliers_detected=outliers_detected,
        outliers_dropped=outliers_dropped,
        outliers_reassigned=outliers_reassigned,
        silhouette_score=quality.silhouette_score,
        davies_bouldin_score=quality.davies_bouldin_score,
        calinski_harabasz_score=quality.calinski_harabasz_score,
        label_counts=label_counts,
    )
