from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from routers import ingest, cluster, tsne, search

app = FastAPI(title="Lead Intelligence API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingest.router)
app.include_router(cluster.router)
app.include_router(tsne.router)
app.include_router(search.router)


@app.on_event("startup")
async def startup_recovery() -> None:
    await ingest.recover_incomplete_jobs()


@app.get("/health")
async def health():
    return {"status": "ok"}
