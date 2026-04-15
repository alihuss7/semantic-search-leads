import time

from fastapi import APIRouter, Query
from sqlalchemy import text

from database import AsyncSessionLocal
from schemas import SearchResponse, SearchResult
from services.embedding import embed_query

router = APIRouter(tags=["search"])


@router.get("/search", response_model=SearchResponse)
async def semantic_search(
    q: str = Query(..., min_length=1),
    limit: int = Query(10, ge=1, le=50),
    threshold: float = Query(0.3, ge=0.0, le=2.0),
):
    t0 = time.perf_counter()
    query_vec = await embed_query(q)
    latency_ms = (time.perf_counter() - t0) * 1000

    vec_str = "[" + ",".join(str(v) for v in query_vec) + "]"

    sql = text("""
        SELECT
            id,
            story,
            raw_data,
            cluster_label,
            cluster_algorithm,
            kmeans_label,
            hdbscan_label,
            (embedding <=> CAST(:qvec AS vector)) AS cosine_distance
        FROM leads
        WHERE embedding IS NOT NULL
          AND (embedding <=> CAST(:qvec AS vector)) < :threshold
        ORDER BY cosine_distance ASC
        LIMIT :limit
    """)

    async with AsyncSessionLocal() as session:
        result = await session.execute(sql, {"qvec": vec_str, "threshold": threshold, "limit": limit})
        rows = result.mappings().all()

    results = [
        SearchResult(
            id=row["id"],
            story=row["story"],
            raw_data=row["raw_data"],
            cosine_distance=float(row["cosine_distance"]),
            similarity_score=round(1 - float(row["cosine_distance"]), 4),
            cluster_label=row["cluster_label"],
            cluster_algorithm=row["cluster_algorithm"],
            kmeans_label=row["kmeans_label"],
            hdbscan_label=row["hdbscan_label"],
        )
        for row in rows
    ]

    return SearchResponse(
        query=q,
        results=results,
        total_returned=len(results),
        embedding_latency_ms=round(latency_ms, 2),
    )
