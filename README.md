# Semantic Search Leads

A local lead-intelligence app for CSV ingestion, embedding, clustering, t-SNE projection, and semantic search.

## Stack
- Backend: FastAPI, SQLAlchemy, PostgreSQL + pgvector, Gemini APIs
- Frontend: Next.js, React Query, Plotly
- Infra: Docker Compose (Postgres)

## Prerequisites
- Docker Desktop (running)
- Python 3.12+
- Node.js 18+
- npm

## Quick Start
1. Copy env files:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

2. Edit `backend/.env` and set:
- `GOOGLE_AI_API_KEY` (required)
- `DATABASE_URL` (default works with this repo)

3. Start everything:

```bash
./start.sh
```

4. Open:
- Frontend: `http://localhost:3000`
- Backend health: `http://localhost:8000/health`

Stop with `Ctrl+C`.

## What `start.sh` Does
- Starts PostgreSQL (`docker compose up -d db`)
- Waits for DB process and auth readiness
- Applies `schema.sql`
- Installs backend/frontend dependencies if needed
- Starts backend on `:8000` and frontend on `:3000`

## Core Behavior
- `POST /ingest` with no file uses `assets/Leads.csv`
- New ingest replaces existing data (`TRUNCATE leads RESTART IDENTITY`)
- `max_rows` default is `50`

## API (Technical)

### Health
- `GET /health`

### Ingest
- `POST /ingest`
- `GET /ingest/{job_id}/status`
- `POST /ingest/{job_id}/cancel`
- `POST /ingest/{job_id}/retry`
- `GET /ingest/{job_id}/validation-report.csv`

Input:
- `file` (optional `.csv`, multipart)
- `max_rows` (optional, `>=1`, form or query)

Job statuses:
- `queued`, `running`, `completed`, `completed_with_errors`, `failed`, `cancelled`

### Clustering
- `POST /cluster`

Important controls (all optional, defaults applied):
- `algorithm`: `kmeans`, `mini_batch_kmeans`, `agglomerative`, `dbscan`, `optics`, `birch`, `gaussian_mixture`, `hdbscan`
- `distance_metric`: `euclidean`, `manhattan`, `cosine` (algorithm-dependent)
- `n_clusters`, `auto_tune_k`, `k_min`, `k_max`, `auto_tune_objective`
- `outlier_policy`: `keep`, `drop`, `nearest`
- `normalize_embeddings`, `pca_components`, `random_state`, `lock_random_state`
- Density/hierarchical/mixture-specific params: `min_cluster_size`, `min_samples`, `eps`, `max_eps`, `linkage`, `covariance_type`, `birch_threshold`, `birch_branching_factor`

### t-SNE
- `GET /tsne`

Query params:
- `recompute` (default `false`)
- `perplexity` (used when recomputing)
- `n_iter` (used when recomputing)

### Search
- `GET /search`

Query params:
- `q` (required)
- `limit` (default `10`)
- `threshold` (default `0.3`)

## Examples

```bash
# Ingest default assets/Leads.csv
curl -X POST http://localhost:8000/ingest
```

```bash
# Ingest uploaded CSV
curl -X POST http://localhost:8000/ingest \
  -F "file=@/absolute/path/to/leads.csv" \
  -F "max_rows=50"
```

```bash
# Cluster
curl -X POST http://localhost:8000/cluster \
  -H "Content-Type: application/json" \
  -d '{"algorithm":"kmeans","n_clusters":8}'
```

```bash
# Recompute t-SNE
curl "http://localhost:8000/tsne?recompute=true&perplexity=30&n_iter=1000"
```

```bash
# Semantic search
curl "http://localhost:8000/search?q=enterprise%20lead&limit=10&threshold=0.3"
```

## Frontend API Base URL
Frontend defaults to `http://localhost:8000`.

Override via `frontend/.env.local`:

```bash
NEXT_PUBLIC_API_BASE_URL=http://your-host:8000
```

## Regenerate Frontend Types

```bash
cd frontend
npm run generate:types
```

## Troubleshooting

### Docker API socket error
`failed to connect to the docker API at unix:///var/run/docker.sock`

- Start Docker Desktop
- Confirm with `docker ps`
- Re-run `./start.sh`

### DB auth/role errors
Examples:
- `role "postgres" does not exist`
- `Could not authenticate with DATABASE_URL user ...`

Fix:

```bash
docker compose down -v
./start.sh
```

Then keep `backend/.env` aligned with:

```env
DATABASE_URL=postgresql+asyncpg://postgres:password@127.0.0.1:5433/leads_db
```

### Missing `ingest_jobs` table
- Re-apply schema:

```bash
cat schema.sql | docker compose exec -T db psql -U postgres -d leads_db
```

### Gemini key/model errors
- Set valid `GOOGLE_AI_API_KEY`
- Ensure `GOOGLE_TEXT_MODEL` is available to your key
- Restart backend
