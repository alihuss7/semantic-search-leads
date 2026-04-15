-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Main leads table
CREATE TABLE IF NOT EXISTS leads (
    id            SERIAL PRIMARY KEY,
    raw_data      JSONB          NOT NULL,
    story         TEXT           NOT NULL,
    embedding     vector(768)    NOT NULL,
    cluster_label INTEGER        DEFAULT NULL,
    cluster_algorithm TEXT       DEFAULT NULL,
    kmeans_label  INTEGER        DEFAULT NULL,
    hdbscan_label INTEGER        DEFAULT NULL,
    tsne_x        FLOAT          DEFAULT NULL,
    tsne_y        FLOAT          DEFAULT NULL,
    created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- Ingestion job tracking (persistent across app restarts)
CREATE TABLE IF NOT EXISTS ingest_jobs (
    job_id          VARCHAR(36)    PRIMARY KEY,
    retry_of_job_id VARCHAR(36)    DEFAULT NULL,
    filename        TEXT           NOT NULL,
    source_csv      BYTEA          DEFAULT NULL,
    max_rows_requested INTEGER     NOT NULL DEFAULT 50,
    status          TEXT           NOT NULL,
    total_rows      INTEGER        NOT NULL DEFAULT 0,
    processed_rows  INTEGER        NOT NULL DEFAULT 0,
    failed_rows     INTEGER        NOT NULL DEFAULT 0,
    validation_failed_rows INTEGER NOT NULL DEFAULT 0,
    processing_failed_rows INTEGER NOT NULL DEFAULT 0,
    errors          JSONB          NOT NULL DEFAULT '[]'::jsonb,
    validation_errors JSONB        NOT NULL DEFAULT '[]'::jsonb,
    started_at      TIMESTAMPTZ    DEFAULT NULL,
    completed_at    TIMESTAMPTZ    DEFAULT NULL,
    cancelled_at    TIMESTAMPTZ    DEFAULT NULL,
    phase           TEXT           NOT NULL DEFAULT 'Queued',
    eta_seconds     INTEGER        DEFAULT NULL,
    elapsed_seconds INTEGER        NOT NULL DEFAULT 0,
    rows_per_second FLOAT          NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT ingest_jobs_status_chk
      CHECK (status IN ('queued', 'running', 'completed', 'completed_with_errors', 'failed', 'cancelled'))
);

ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS retry_of_job_id VARCHAR(36) DEFAULT NULL;
ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS source_csv BYTEA DEFAULT NULL;
ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS max_rows_requested INTEGER NOT NULL DEFAULT 50;
ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS validation_failed_rows INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS processing_failed_rows INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS cluster_label INTEGER DEFAULT NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS cluster_algorithm TEXT DEFAULT NULL;

ALTER TABLE ingest_jobs DROP CONSTRAINT IF EXISTS ingest_jobs_status_chk;
ALTER TABLE ingest_jobs ADD CONSTRAINT ingest_jobs_status_chk
  CHECK (status IN ('queued', 'running', 'completed', 'completed_with_errors', 'failed', 'cancelled'));

-- IVFFlat index for approximate cosine similarity search
CREATE INDEX IF NOT EXISTS leads_embedding_idx
    ON leads USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS leads_updated_at ON leads;
CREATE TRIGGER leads_updated_at
    BEFORE UPDATE ON leads
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS ingest_jobs_updated_at ON ingest_jobs;
CREATE TRIGGER ingest_jobs_updated_at
    BEFORE UPDATE ON ingest_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
