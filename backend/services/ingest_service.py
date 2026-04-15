import asyncio
import csv
import io
import json
import logging
import pathlib
import time
from datetime import datetime, timezone
from typing import Any, Literal, cast
from uuid import uuid4

from fastapi import BackgroundTasks, HTTPException, Response, UploadFile
from sqlalchemy import select, text, update
from sqlalchemy.exc import ProgrammingError

from database import AsyncSessionLocal
from models import IngestJob, Lead
from schemas import IngestResponse, JobStatus
from services.embedding import embed_documents
from services.story import synthesize_stories

logger = logging.getLogger(__name__)

ASSETS_DIR = (pathlib.Path(__file__).resolve().parent.parent.parent / "assets").resolve()
DEFAULT_ASSET_FILENAME = "Leads.csv"
DEFAULT_BATCH_SIZE = 20
VALIDATION_PREVIEW_LIMIT = 10

ACTIVE_STATUSES = {"queued", "running"}
TERMINAL_STATUSES = {"completed", "completed_with_errors", "failed", "cancelled"}

JobStatusValue = Literal["queued", "running", "completed", "completed_with_errors", "failed", "cancelled"]


def _now_dt() -> datetime:
    return datetime.now(timezone.utc)


def _to_iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt is not None else None


def _safe_asset_csv_path(filename: str) -> pathlib.Path:
    cleaned = filename.strip()
    candidate = pathlib.Path(cleaned)

    if not cleaned:
        raise ValueError("filename is required")
    if candidate.is_absolute() or ".." in candidate.parts:
        raise ValueError("filename must point to a CSV file in assets/")
    if len(candidate.parts) != 1:
        raise ValueError("filename must not include directories")
    if candidate.suffix.lower() != ".csv":
        raise ValueError("filename must end with .csv")

    path = (ASSETS_DIR / candidate).resolve()
    if path.parent != ASSETS_DIR:
        raise ValueError("filename must point to a CSV file in assets/")
    return path


def _load_default_csv() -> tuple[str, bytes]:
    path = _safe_asset_csv_path(DEFAULT_ASSET_FILENAME)
    if not path.exists():
        raise FileNotFoundError(f"assets/{path.name} not found")
    return path.name, path.read_bytes()


async def _read_uploaded_csv(file: UploadFile) -> tuple[str, bytes]:
    original_name = (file.filename or "").strip()
    base_name = pathlib.Path(original_name).name
    if not base_name:
        raise ValueError("Uploaded file must have a filename")
    if pathlib.Path(base_name).suffix.lower() != ".csv":
        raise ValueError("Uploaded file must be a .csv")

    raw_bytes = await file.read()
    if not raw_bytes:
        raise ValueError("Uploaded CSV is empty")
    return base_name, raw_bytes


def _compute_metrics(processed_rows: int, total_rows: int, start_time: float) -> tuple[int | None, int, float]:
    elapsed = max(time.monotonic() - start_time, 1e-6)
    elapsed_seconds = round(elapsed)

    if processed_rows <= 0:
        return None, elapsed_seconds, 0.0

    rows_per_second = processed_rows / elapsed
    remaining = max(total_rows - processed_rows, 0)
    eta_seconds = round(remaining / rows_per_second) if rows_per_second > 0 else None
    return eta_seconds, elapsed_seconds, round(rows_per_second, 1)


def _validate_rows(rows: list[dict], start_row_number: int = 2) -> tuple[list[tuple[int, dict[str, str]]], list[dict[str, Any]]]:
    valid_rows: list[tuple[int, dict[str, str]]] = []
    validation_errors: list[dict[str, Any]] = []

    for row_number, row in enumerate(rows, start=start_row_number):
        normalized: dict[str, str] = {}
        has_extra_columns = False

        for key, value in row.items():
            if key is None:
                if value not in (None, "", []):
                    has_extra_columns = True
                continue
            normalized[str(key)] = "" if value is None else str(value)

        if has_extra_columns:
            validation_errors.append({
                "row_number": row_number,
                "reason": "Row has more values than CSV headers",
                "row_data": normalized,
            })
            continue

        if not any(v.strip() for v in normalized.values()):
            validation_errors.append({
                "row_number": row_number,
                "reason": "Row is empty",
                "row_data": normalized,
            })
            continue

        valid_rows.append((row_number, normalized))

    return valid_rows, validation_errors


def _job_to_status(job: IngestJob) -> JobStatus:
    status = cast(JobStatusValue, job.status)
    validation_errors = job.validation_errors or []
    preview = validation_errors[:VALIDATION_PREVIEW_LIMIT]
    has_validation_report = bool(validation_errors)
    validation_report_url = f"/ingest/{job.job_id}/validation-report.csv" if has_validation_report else None

    return JobStatus(
        job_id=job.job_id,
        status=status,
        total_rows=job.total_rows,
        processed_rows=job.processed_rows,
        failed_rows=job.failed_rows,
        validation_failed_rows=job.validation_failed_rows,
        processing_failed_rows=job.processing_failed_rows,
        errors=job.errors or [],
        validation_errors_preview=preview,
        has_validation_report=has_validation_report,
        validation_report_url=validation_report_url,
        max_rows_requested=job.max_rows_requested,
        started_at=_to_iso(job.started_at),
        completed_at=_to_iso(job.completed_at),
        cancelled_at=_to_iso(job.cancelled_at),
        phase=job.phase,
        eta_seconds=job.eta_seconds,
        elapsed_seconds=job.elapsed_seconds,
        rows_per_second=job.rows_per_second,
    )


async def _update_job(job_id: str, **values) -> None:
    if not values:
        return
    async with AsyncSessionLocal() as session:
        await session.execute(
            update(IngestJob).where(IngestJob.job_id == job_id).values(**values)
        )
        await session.commit()


async def _get_job(job_id: str) -> IngestJob | None:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(IngestJob).where(IngestJob.job_id == job_id)
        )
        return result.scalar_one_or_none()


async def _is_cancelled(job_id: str) -> bool:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(IngestJob.status).where(IngestJob.job_id == job_id)
        )
        status = result.scalar_one_or_none()
    return status == "cancelled"


async def _mark_cancelled(
    job_id: str,
    processed_rows: int,
    failed_rows: int,
    validation_failed_rows: int,
    processing_failed_rows: int,
    errors: list[str],
    validation_errors: list[dict[str, Any]],
    start_time: float,
) -> None:
    _, elapsed_seconds, rows_per_second = _compute_metrics(processed_rows, processed_rows, start_time)
    now = _now_dt()
    await _update_job(
        job_id,
        status="cancelled",
        phase="Cancelled by user",
        processed_rows=processed_rows,
        failed_rows=failed_rows,
        validation_failed_rows=validation_failed_rows,
        processing_failed_rows=processing_failed_rows,
        errors=errors,
        validation_errors=validation_errors,
        eta_seconds=None,
        elapsed_seconds=elapsed_seconds,
        rows_per_second=rows_per_second,
        cancelled_at=now,
        completed_at=now,
    )


async def recover_incomplete_jobs() -> int:
    try:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                update(IngestJob)
                .where(IngestJob.status.in_(ACTIVE_STATUSES))
                .values(
                    status="failed",
                    phase="Interrupted (server restarted)",
                    completed_at=_now_dt(),
                    eta_seconds=None,
                )
            )
            await session.commit()
        return int(result.rowcount or 0)
    except ProgrammingError as exc:
        msg = str(exc).lower()
        if "ingest_jobs" in msg and ("does not exist" in msg or "undefinedtable" in msg):
            logger.warning("Skipping ingest job recovery because ingest_jobs table does not exist yet.")
            return 0
        raise


async def _process_chunk_with_retry(
    job_id: str,
    chunk_rows: list[dict[str, str]],
    batch_size: int,
    max_retries: int = 3,
) -> tuple[list[str], list[list[float]]]:
    for attempt in range(max_retries):
        if await _is_cancelled(job_id):
            raise asyncio.CancelledError("Ingestion cancelled")
        try:
            stories = await synthesize_stories(chunk_rows, batch_size=batch_size)
            embeddings = await embed_documents(stories, batch_size=batch_size)
            return stories, embeddings
        except Exception:
            if attempt == max_retries - 1:
                raise
            wait = 2 ** attempt * 5  # 5s, 10s, 20s
            await asyncio.sleep(wait)
    raise RuntimeError("unreachable")


async def _run_pipeline(
    job_id: str,
    filename: str,
    raw_bytes: bytes,
    batch_size: int = DEFAULT_BATCH_SIZE,
    max_rows: int | None = None,
) -> None:
    processed_rows = 0
    failed_rows = 0
    validation_failed_rows = 0
    processing_failed_rows = 0
    processing_errors: list[str] = []
    validation_errors: list[dict[str, Any]] = []
    start_time = time.monotonic()

    if await _is_cancelled(job_id):
        return

    await _update_job(
        job_id,
        status="running",
        started_at=_now_dt(),
        phase=f"Loading CSV ({filename})",
        processed_rows=0,
        failed_rows=0,
        validation_failed_rows=0,
        processing_failed_rows=0,
        errors=[],
        validation_errors=[],
    )

    try:
        reader = csv.DictReader(io.StringIO(raw_bytes.decode("utf-8-sig")))
        if not reader.fieldnames or not any(str(f).strip() for f in reader.fieldnames):
            raise ValueError("CSV header row is missing or invalid")

        raw_rows = list(reader)
        if max_rows:
            raw_rows = raw_rows[:max_rows]
        total_rows = len(raw_rows)

        valid_rows, validation_errors = _validate_rows(raw_rows, start_row_number=2)
        validation_failed_rows = len(validation_errors)
        failed_rows = validation_failed_rows
        processed_rows = validation_failed_rows

        eta_seconds, elapsed_seconds, rows_per_second = _compute_metrics(processed_rows, total_rows, start_time)
        await _update_job(
            job_id,
            total_rows=total_rows,
            processed_rows=processed_rows,
            failed_rows=failed_rows,
            validation_failed_rows=validation_failed_rows,
            processing_failed_rows=processing_failed_rows,
            validation_errors=validation_errors,
            errors=processing_errors,
            phase="Preparing data",
            eta_seconds=eta_seconds,
            elapsed_seconds=elapsed_seconds,
            rows_per_second=rows_per_second,
        )

        # Simplified behavior: each ingest replaces the existing dataset.
        async with AsyncSessionLocal() as session:
            await session.execute(text("TRUNCATE TABLE leads RESTART IDENTITY"))
            await session.commit()

        if total_rows == 0:
            await _update_job(
                job_id,
                status="completed",
                completed_at=_now_dt(),
                phase="Completed",
                elapsed_seconds=round(time.monotonic() - start_time),
                eta_seconds=0,
            )
            return

        if await _is_cancelled(job_id):
            await _mark_cancelled(
                job_id,
                processed_rows=processed_rows,
                failed_rows=failed_rows,
                validation_failed_rows=validation_failed_rows,
                processing_failed_rows=processing_failed_rows,
                errors=processing_errors,
                validation_errors=validation_errors,
                start_time=start_time,
            )
            return

        if not valid_rows:
            await _update_job(
                job_id,
                status="completed_with_errors",
                completed_at=_now_dt(),
                phase="Completed with errors",
                eta_seconds=0,
                elapsed_seconds=round(time.monotonic() - start_time),
            )
            return

        chunk_size = max(50, min(200, batch_size * 5))
        total_chunks = (len(valid_rows) + chunk_size - 1) // chunk_size

        for chunk_idx, i in enumerate(range(0, len(valid_rows), chunk_size)):
            if await _is_cancelled(job_id):
                await _mark_cancelled(
                    job_id,
                    processed_rows=processed_rows,
                    failed_rows=failed_rows,
                    validation_failed_rows=validation_failed_rows,
                    processing_failed_rows=processing_failed_rows,
                    errors=processing_errors,
                    validation_errors=validation_errors,
                    start_time=start_time,
                )
                return

            chunk = valid_rows[i : i + chunk_size]
            phase = f"Processing chunk {chunk_idx + 1}/{total_chunks}"
            await _update_job(job_id, phase=phase)

            chunk_row_numbers = [row_number for row_number, _ in chunk]
            chunk_rows = [row for _, row in chunk]

            try:
                stories, embeddings = await _process_chunk_with_retry(job_id, chunk_rows, batch_size=batch_size)
            except asyncio.CancelledError:
                await _mark_cancelled(
                    job_id,
                    processed_rows=processed_rows,
                    failed_rows=failed_rows,
                    validation_failed_rows=validation_failed_rows,
                    processing_failed_rows=processing_failed_rows,
                    errors=processing_errors,
                    validation_errors=validation_errors,
                    start_time=start_time,
                )
                return
            except Exception as exc:
                row_start = chunk_row_numbers[0]
                row_end = chunk_row_numbers[-1]
                processing_errors.append(f"Rows {row_start}-{row_end}: {exc}")
                processing_failed_rows += len(chunk)
                failed_rows = validation_failed_rows + processing_failed_rows
                processed_rows += len(chunk)
                eta_seconds, elapsed_seconds, rows_per_second = _compute_metrics(processed_rows, total_rows, start_time)
                await _update_job(
                    job_id,
                    processed_rows=processed_rows,
                    failed_rows=failed_rows,
                    validation_failed_rows=validation_failed_rows,
                    processing_failed_rows=processing_failed_rows,
                    errors=processing_errors,
                    validation_errors=validation_errors,
                    eta_seconds=eta_seconds,
                    elapsed_seconds=elapsed_seconds,
                    rows_per_second=rows_per_second,
                    phase=phase,
                )
                continue

            if await _is_cancelled(job_id):
                await _mark_cancelled(
                    job_id,
                    processed_rows=processed_rows,
                    failed_rows=failed_rows,
                    validation_failed_rows=validation_failed_rows,
                    processing_failed_rows=processing_failed_rows,
                    errors=processing_errors,
                    validation_errors=validation_errors,
                    start_time=start_time,
                )
                return

            async with AsyncSessionLocal() as session:
                session.add_all([
                    Lead(raw_data=dict(row), story=story, embedding=emb)
                    for row, story, emb in zip(chunk_rows, stories, embeddings)
                ])
                await session.commit()

            processed_rows += len(chunk)
            eta_seconds, elapsed_seconds, rows_per_second = _compute_metrics(processed_rows, total_rows, start_time)
            await _update_job(
                job_id,
                processed_rows=processed_rows,
                failed_rows=failed_rows,
                validation_failed_rows=validation_failed_rows,
                processing_failed_rows=processing_failed_rows,
                errors=processing_errors,
                validation_errors=validation_errors,
                eta_seconds=eta_seconds,
                elapsed_seconds=elapsed_seconds,
                rows_per_second=rows_per_second,
                phase=phase,
            )

        final_status = "completed_with_errors" if failed_rows > 0 else "completed"
        final_phase = "Completed with errors" if failed_rows > 0 else "Completed"
        await _update_job(
            job_id,
            status=final_status,
            completed_at=_now_dt(),
            phase=final_phase,
            processed_rows=processed_rows,
            failed_rows=failed_rows,
            validation_failed_rows=validation_failed_rows,
            processing_failed_rows=processing_failed_rows,
            errors=processing_errors,
            validation_errors=validation_errors,
            eta_seconds=0,
            elapsed_seconds=round(time.monotonic() - start_time),
        )

    except Exception as exc:
        processing_errors.append(str(exc))
        await _update_job(
            job_id,
            status="failed",
            completed_at=_now_dt(),
            phase="Failed",
            processed_rows=processed_rows,
            failed_rows=failed_rows,
            validation_failed_rows=validation_failed_rows,
            processing_failed_rows=processing_failed_rows,
            errors=processing_errors,
            validation_errors=validation_errors,
            eta_seconds=None,
            elapsed_seconds=round(time.monotonic() - start_time),
        )


async def start_ingest(
    background_tasks: BackgroundTasks,
    file: UploadFile | None = None,
    max_rows: int = 50,
) -> IngestResponse:

    if file is not None:
        try:
            filename, raw_bytes = await _read_uploaded_csv(file)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        finally:
            await file.close()
    else:
        try:
            filename, raw_bytes = _load_default_csv()
        except (ValueError, FileNotFoundError) as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    job_id = str(uuid4())
    job = IngestJob(
        job_id=job_id,
        retry_of_job_id=None,
        filename=filename,
        source_csv=raw_bytes,
        max_rows_requested=max_rows,
        status="queued",
        total_rows=0,
        processed_rows=0,
        failed_rows=0,
        validation_failed_rows=0,
        processing_failed_rows=0,
        errors=[],
        validation_errors=[],
        started_at=None,
        completed_at=None,
        cancelled_at=None,
        phase="Queued",
        eta_seconds=None,
        elapsed_seconds=0,
        rows_per_second=0.0,
    )

    async with AsyncSessionLocal() as session:
        session.add(job)
        await session.commit()

    background_tasks.add_task(_run_pipeline, job_id, filename, raw_bytes, DEFAULT_BATCH_SIZE, max_rows)
    return IngestResponse(
        job_id=job_id,
        status="queued",
        message="Ingestion started. Poll /ingest/{job_id}/status for progress.",
    )


async def cancel_ingest(job_id: str) -> IngestResponse:
    job = await _get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    current_status = cast(JobStatusValue, job.status)
    if current_status in TERMINAL_STATUSES:
        return IngestResponse(
            job_id=job_id,
            status=current_status,
            message=f"Job is already {current_status}.",
        )

    now = _now_dt()
    await _update_job(
        job_id,
        status="cancelled",
        phase="Cancellation requested",
        cancelled_at=now,
        completed_at=now,
        eta_seconds=None,
    )
    return IngestResponse(
        job_id=job_id,
        status="cancelled",
        message="Cancellation requested.",
    )


async def retry_ingest(job_id: str, background_tasks: BackgroundTasks) -> IngestResponse:
    source_job = await _get_job(job_id)
    if not source_job:
        raise HTTPException(status_code=404, detail="Job not found")

    if source_job.status in ACTIVE_STATUSES:
        raise HTTPException(status_code=409, detail="Cannot retry a job that is still running.")

    retry_bytes = source_job.source_csv
    if retry_bytes is None:
        try:
            retry_path = _safe_asset_csv_path(source_job.filename)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Cannot retry job: {exc}") from exc
        if not retry_path.exists():
            raise HTTPException(status_code=400, detail="Cannot retry job: original CSV is no longer available.")
        retry_bytes = retry_path.read_bytes()

    retry_job_id = str(uuid4())
    retry_job = IngestJob(
        job_id=retry_job_id,
        retry_of_job_id=source_job.job_id,
        filename=source_job.filename,
        source_csv=retry_bytes,
        max_rows_requested=source_job.max_rows_requested,
        status="queued",
        total_rows=0,
        processed_rows=0,
        failed_rows=0,
        validation_failed_rows=0,
        processing_failed_rows=0,
        errors=[],
        validation_errors=[],
        started_at=None,
        completed_at=None,
        cancelled_at=None,
        phase="Queued",
        eta_seconds=None,
        elapsed_seconds=0,
        rows_per_second=0.0,
    )

    async with AsyncSessionLocal() as session:
        session.add(retry_job)
        await session.commit()

    background_tasks.add_task(
        _run_pipeline,
        retry_job_id,
        source_job.filename,
        retry_bytes,
        DEFAULT_BATCH_SIZE,
        source_job.max_rows_requested,
    )

    return IngestResponse(
        job_id=retry_job_id,
        status="queued",
        message=f"Retry started from job {job_id}.",
    )


async def get_ingest_status(job_id: str) -> JobStatus:
    job = await _get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_to_status(job)


async def get_validation_report_csv(job_id: str) -> Response:
    job = await _get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    validation_errors = job.validation_errors or []
    if not validation_errors:
        raise HTTPException(status_code=404, detail="No validation report available for this job.")

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["row_number", "reason", "row_data_json"])
    for item in validation_errors:
        writer.writerow([
            item.get("row_number", ""),
            item.get("reason", ""),
            json.dumps(item.get("row_data", {}), ensure_ascii=False),
        ])

    content = output.getvalue()
    headers = {
        "Content-Disposition": f'attachment; filename="{job_id}-validation-report.csv"',
    }
    return Response(content=content, media_type="text/csv; charset=utf-8", headers=headers)
