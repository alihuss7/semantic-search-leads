# Semantic Search Leads

CSV lead ingestion + semantic search demo.

- Backend: FastAPI + PostgreSQL/pgvector + Gemini APIs
- Frontend: Next.js + React Query + Plotly

## Prerequisites

- Docker Desktop (running)
- Python 3.12+
- Node.js 18+
- npm

## Quick Start

### 1. Configure env files

From repo root:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Then edit `backend/.env` and set:

- `GOOGLE_AI_API_KEY` to a valid key from Google AI Studio
- `DATABASE_URL` (keep default unless your DB host/port/user differs)

### 2. Start everything with one command

From repo root:

```bash
./start.sh
```

What it does:

- Starts PostgreSQL in Docker
- Waits for DB readiness
- Applies `schema.sql`
- Creates `backend/.venv` if missing
- Installs backend/frontend dependencies if needed
- Runs backend (`:8000`) and frontend (`:3000`)

Stop both app servers with `Ctrl+C`.

### 3. Verify app health

```bash
curl http://localhost:8000/health
```

Expected response:

```json
{"status":"ok"}
```

## Manual Startup (Two Terminals)

### 1. Start PostgreSQL (Docker)

From the repo root:

```bash
docker compose up -d db
docker compose exec -T db pg_isready -U postgres -d leads_db
cat schema.sql | docker compose exec -T db psql -U postgres -d leads_db
```

Notes:

- `GOOGLE_TEXT_MODEL` must be available to your API key.
- Keep `GOOGLE_EMBEDDING_DIM=768` unless you also change `schema.sql` vector size.
- `ALLOWED_ORIGINS` accepts comma-separated origins.

### 2. Run backend

Terminal 1:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --port 8000
```

Health check:

```bash
curl http://localhost:8000/health
```

### 3. Run frontend

Terminal 2:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

### 4. Run ingest + analytics pipeline

Typical API flow:

- Start ingest with `POST /ingest` (optional file upload + `max_rows`)
- Poll progress with `GET /ingest/{job_id}/status`
- Optionally cancel with `POST /ingest/{job_id}/cancel`
- Retry finished/cancelled jobs with `POST /ingest/{job_id}/retry`
- Download invalid-row report with `GET /ingest/{job_id}/validation-report.csv`
- Run clustering with `POST /cluster`
- Compute/recompute projection with `GET /tsne`
- Run semantic retrieval with `GET /search`

If no file is uploaded, ingest uses `assets/Leads.csv` by default.  
Each ingest run truncates and replaces existing leads.

## API Endpoints

- `GET /health`
- `POST /ingest`
- `GET /ingest/{job_id}/status`
- `POST /ingest/{job_id}/cancel`
- `POST /ingest/{job_id}/retry`
- `GET /ingest/{job_id}/validation-report.csv`
- `POST /cluster`
- `GET /tsne`
- `GET /search`

## Control Reference (Technical)

### Ingest controls (`POST /ingest`)

Request type:

- `multipart/form-data` when uploading a file or sending `max_rows` as form data
- Query param (`?max_rows=<n>`) is also supported

| Parameter | Type | Default | Constraints | Notes |
|---|---|---:|---|---|
| `file` | upload (`.csv`) | omitted | must be `.csv` when provided | If omitted, backend loads `assets/Leads.csv` |
| `max_rows` | integer | `50` | `>= 1` | Limits rows processed from input CSV |

Behavior:

- Ingest is asynchronous and returns `202` with a `job_id`.
- Jobs can be `queued`, `running`, `completed`, `completed_with_errors`, `failed`, `cancelled`.
- Pipeline stores source CSV bytes for retry and emits validation preview + downloadable report.
- Each new ingest run executes `TRUNCATE TABLE leads RESTART IDENTITY` before inserting new rows.

### Cluster controls (`POST /cluster`)

All fields are optional in the request body; schema defaults are applied.

| Field | Type | Default | Constraints |
|---|---|---:|---|
| `algorithm` | enum | `kmeans` | `kmeans`, `mini_batch_kmeans`, `agglomerative`, `dbscan`, `optics`, `birch`, `gaussian_mixture`, `hdbscan` |
| `distance_metric` | enum | `euclidean` | `euclidean`, `manhattan`, `cosine` (algorithm-dependent) |
| `outlier_policy` | enum | `keep` | `keep`, `drop`, `nearest` |
| `normalize_embeddings` | bool | `false` | - |
| `pca_components` | int/null | `null` | `2..768` |
| `random_state` | int | `42` | `0..2147483647` |
| `lock_random_state` | bool | `true` | when `false`, server chooses random seed |
| `n_clusters` | int | `8` | `2..200` |
| `auto_tune_k` | bool | `false` | only for k-based algorithms |
| `k_min` | int | `2` | `2..200` |
| `k_max` | int | `12` | `2..200`, must be `>= k_min`, range width max `40` |
| `auto_tune_objective` | enum | `silhouette` | `silhouette`, `davies_bouldin`, `calinski_harabasz` |
| `min_cluster_size` | int | `5` | `2..1000` |
| `min_samples` | int/null | `null` | `1..1000` |
| `eps` | float | `0.35` | `(0, 10]` |
| `max_eps` | float/null | `null` | `(0, 10]`, must be `> eps` for `optics` |
| `linkage` | enum | `average` | `ward`, `complete`, `average`, `single` |
| `covariance_type` | enum | `full` | `full`, `tied`, `diag`, `spherical` |
| `birch_threshold` | float | `0.5` | `(0, 10]` |
| `birch_branching_factor` | int | `50` | `2..500` |

Distance metric support by algorithm:

- `kmeans`, `mini_batch_kmeans`, `birch`, `gaussian_mixture`: `euclidean`
- `agglomerative`, `dbscan`, `optics`: `euclidean`, `manhattan`, `cosine`
- `hdbscan`: `euclidean`, `manhattan`
- `agglomerative` with `linkage=ward` requires `distance_metric=euclidean`

Runtime guards:

- At least 2 leads with embeddings are required.
- For k-based algorithms, `n_clusters` cannot exceed number of available embedded leads.
- For `hdbscan`, `min_cluster_size` cannot exceed number of available embedded leads.

### t-SNE controls (`GET /tsne`)

| Query Param | Type | Default | Constraints | Notes |
|---|---|---:|---|---|
| `recompute` | bool | `false` | - | When `true`, always recomputes and overwrites stored coordinates |
| `perplexity` | float | `30.0` | `(0, 200]` | Used only when recomputing |
| `n_iter` | int | `1000` | `250..10000` | Used only when recomputing |

Response includes:

- `from_cache`: `true` when stored coordinates were reused.
- `computed_at`: server timestamp for response generation.

### Search controls (`GET /search`)

| Query Param | Type | Default | Constraints |
|---|---|---:|---|
| `q` | string | required | min length `1` |
| `limit` | int | `10` | `1..50` |
| `threshold` | float | `0.3` | `0..2` |

Notes:

- Search filters by cosine distance: rows where distance `< threshold`.
- Results are ordered ascending by cosine distance (smaller = closer).
- `similarity_score` in response is `1 - cosine_distance`.

Examples:

```bash
# Use default assets/Leads.csv
curl -X POST http://localhost:8000/ingest
```

```bash
# Upload a CSV file
curl -X POST http://localhost:8000/ingest \
  -F "file=@/absolute/path/to/leads.csv" \
  -F "max_rows=50"
```

```bash
curl "http://localhost:8000/ingest/<job_id>/status"
```

```bash
curl -X POST "http://localhost:8000/ingest/<job_id>/cancel"
```

```bash
curl -X POST "http://localhost:8000/ingest/<job_id>/retry"
```

```bash
curl -OJ "http://localhost:8000/ingest/<job_id>/validation-report.csv"
```

```bash
curl -X POST http://localhost:8000/cluster \
  -H "Content-Type: application/json" \
  -d '{"algorithm":"kmeans","n_clusters":8}'
```

```bash
curl -X POST http://localhost:8000/cluster \
  -H "Content-Type: application/json" \
  -d '{
    "algorithm":"agglomerative",
    "distance_metric":"cosine",
    "n_clusters":10,
    "auto_tune_k":true,
    "k_min":4,
    "k_max":14,
    "auto_tune_objective":"silhouette",
    "normalize_embeddings":true,
    "pca_components":64,
    "outlier_policy":"nearest",
    "lock_random_state":true,
    "random_state":42
  }'
```

```bash
curl "http://localhost:8000/tsne?recompute=true&perplexity=30&n_iter=1000"
```

```bash
curl "http://localhost:8000/search?q=enterprise%20lead&limit=10&threshold=0.3"
```

## Frontend API Base URL

Frontend defaults to `http://localhost:8000`.

To use a different backend URL, set `NEXT_PUBLIC_API_BASE_URL` in `frontend/.env.local`:

```bash
NEXT_PUBLIC_API_BASE_URL=http://your-host:8000
```

## Regenerate Frontend API Types

Frontend API types are generated from the backend OpenAPI schema:

```bash
cd frontend
npm run generate:types
```

## Troubleshooting

### `role "postgres" does not exist`

Your DB volume was initialized with a different user. Reset it:

```bash
docker compose down -v
docker compose up -d db
cat schema.sql | docker compose exec -T db psql -U postgres -d leads_db
```

Then keep:

`DATABASE_URL=postgresql+asyncpg://postgres:password@127.0.0.1:5433/leads_db`

### `Could not authenticate with DATABASE_URL user ...`

Your `backend/.env` DB user/password does not match the Docker DB volume.

- Set `DATABASE_URL` to `postgresql+asyncpg://postgres:password@127.0.0.1:5433/leads_db`
- Reset DB volume once: `docker compose down -v`
- Run `./start.sh` again

If `start.sh` prints a fallback warning, the app may still start for that run, but update `backend/.env` so future runs are consistent.

### `relation "ingest_jobs" does not exist`

Your DB schema is older than the backend code. Apply schema updates:

```bash
cat schema.sql | docker compose exec -T db psql -U postgres -d leads_db
```

### `API_KEY_INVALID`

Your Gemini API key is invalid/revoked/wrong project.

- Create a key in Google AI Studio.
- Update `GOOGLE_AI_API_KEY` in `backend/.env`.
- Restart backend.

### `model ... is not found ... generateContent`

Your configured model is not available to the key/version. List models:

```bash
cd backend
source .venv/bin/activate
python - <<'PY'
import os
from dotenv import load_dotenv
import google.generativeai as genai

load_dotenv(dotenv_path=".env")
genai.configure(api_key=os.environ["GOOGLE_AI_API_KEY"])
for m in genai.list_models():
    methods = getattr(m, "supported_generation_methods", []) or []
    if "generateContent" in methods:
        print(m.name)
PY
```

Set `GOOGLE_TEXT_MODEL` to one of the printed `models/...` names, then restart backend.

### `failed to connect to the docker API at unix:///var/run/docker.sock`

Docker Desktop is not running or not reachable from your shell.

- Start Docker Desktop and wait until it is fully initialized.
- Re-run `docker ps` to confirm Docker is healthy.
- Run `./start.sh` again.

### CORS or frontend cannot call backend

- Verify backend is running on `http://localhost:8000`.
- Verify `ALLOWED_ORIGINS` includes your frontend origin.
- If frontend is not on `localhost:3000`, set `NEXT_PUBLIC_API_BASE_URL` in frontend env and restart `npm run dev`.

### Frontend chunk/load errors

```bash
cd frontend
rm -rf .next
npm run dev
```
