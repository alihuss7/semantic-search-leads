from datetime import datetime
from sqlalchemy import Integer, Text, Float, DateTime, func, String, LargeBinary
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from pgvector.sqlalchemy import Vector

from database import Base


class Lead(Base):
    __tablename__ = "leads"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    raw_data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    story: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list] = mapped_column(Vector(768), nullable=False)
    cluster_label: Mapped[int | None] = mapped_column(Integer, default=None)
    cluster_algorithm: Mapped[str | None] = mapped_column(String(32), default=None)
    kmeans_label: Mapped[int | None] = mapped_column(Integer, default=None)
    hdbscan_label: Mapped[int | None] = mapped_column(Integer, default=None)
    tsne_x: Mapped[float | None] = mapped_column(Float, default=None)
    tsne_y: Mapped[float | None] = mapped_column(Float, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class IngestJob(Base):
    __tablename__ = "ingest_jobs"

    job_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    retry_of_job_id: Mapped[str | None] = mapped_column(String(36), nullable=True, default=None)
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    source_csv: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, default=None)
    max_rows_requested: Mapped[int] = mapped_column(Integer, nullable=False, default=50)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    total_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    processed_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    validation_failed_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    processing_failed_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    errors: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    validation_errors: Mapped[list[dict]] = mapped_column(JSONB, nullable=False, default=list)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    phase: Mapped[str] = mapped_column(Text, nullable=False, default="Queued")
    eta_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    elapsed_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rows_per_second: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
