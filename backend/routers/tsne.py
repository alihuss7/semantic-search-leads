import asyncio
from datetime import datetime, timezone

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import bindparam, select

from database import AsyncSessionLocal, engine
from models import Lead
from schemas import TsnePoint, TsneResponse
from services.projection import compute_tsne

router = APIRouter(tags=["tsne"])


@router.get("/tsne", response_model=TsneResponse)
async def get_tsne(
    recompute: bool = Query(False),
    perplexity: float = Query(30.0, gt=0.0, le=200.0),
    n_iter: int = Query(1000, ge=250, le=10000),
):
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Lead).where(Lead.embedding.isnot(None)).order_by(Lead.id)
        )
        leads = result.scalars().all()

    if not leads:
        raise HTTPException(status_code=404, detail="No leads with embeddings found. Run /ingest first.")

    needs_compute = recompute or any(l.tsne_x is None for l in leads)
    from_cache = not needs_compute

    if needs_compute:
        embeddings = np.array([l.embedding for l in leads], dtype=np.float32)
        try:
            coords = await asyncio.to_thread(
                compute_tsne,
                embeddings,
                perplexity=perplexity,
                n_iter=n_iter,
            )
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"t-SNE failed: {exc}") from exc

        leads_table = Lead.__table__
        update_stmt = (
            leads_table.update()
            .where(leads_table.c.id == bindparam("lead_id"))
            .values(
                tsne_x=bindparam("b_tsne_x"),
                tsne_y=bindparam("b_tsne_y"),
            )
        )
        update_rows = [
            {"lead_id": lead.id, "b_tsne_x": float(x), "b_tsne_y": float(y)}
            for lead, (x, y) in zip(leads, coords)
        ]

        async with engine.begin() as conn:
            await conn.execute(update_stmt, update_rows)

        # Patch in-memory objects so we can build the response immediately
        for lead, (x, y) in zip(leads, coords):
            lead.tsne_x = float(x)
            lead.tsne_y = float(y)

    points = [
        TsnePoint(
            id=l.id,
            x=l.tsne_x,
            y=l.tsne_y,
            story=l.story,
            raw_data=l.raw_data,
            cluster_label=l.cluster_label,
            cluster_algorithm=l.cluster_algorithm,
            kmeans_label=l.kmeans_label,
            hdbscan_label=l.hdbscan_label,
        )
        for l in leads
    ]

    return TsneResponse(
        points=points,
        computed_at=datetime.now(timezone.utc).isoformat(),
        from_cache=from_cache,
    )
