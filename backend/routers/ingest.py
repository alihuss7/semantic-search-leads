from fastapi import APIRouter, BackgroundTasks, File, Form, Query, UploadFile

from schemas import IngestResponse, JobStatus
from services.ingest_service import (
    cancel_ingest,
    get_ingest_status,
    get_validation_report_csv,
    recover_incomplete_jobs as recover_incomplete_jobs_impl,
    retry_ingest,
    start_ingest,
)

router = APIRouter(tags=["ingest"])


@router.post("/ingest", response_model=IngestResponse, status_code=202)
async def start_ingest_route(
    background_tasks: BackgroundTasks,
    file: UploadFile | None = File(default=None),
    max_rows_form: int | None = Form(default=None, ge=1),
    max_rows_query: int | None = Query(default=None, alias="max_rows", ge=1),
) -> IngestResponse:
    max_rows = max_rows_form if max_rows_form is not None else (max_rows_query if max_rows_query is not None else 50)
    return await start_ingest(
        background_tasks=background_tasks,
        file=file,
        max_rows=max_rows,
    )


@router.post("/ingest/{job_id}/cancel", response_model=IngestResponse)
async def cancel_ingest_route(job_id: str) -> IngestResponse:
    return await cancel_ingest(job_id)


@router.post("/ingest/{job_id}/retry", response_model=IngestResponse, status_code=202)
async def retry_ingest_route(job_id: str, background_tasks: BackgroundTasks) -> IngestResponse:
    return await retry_ingest(job_id, background_tasks)


@router.get("/ingest/{job_id}/status", response_model=JobStatus)
async def get_ingest_status_route(job_id: str) -> JobStatus:
    return await get_ingest_status(job_id)


@router.get("/ingest/{job_id}/validation-report.csv")
async def get_validation_report_csv_route(job_id: str):
    return await get_validation_report_csv(job_id)


async def recover_incomplete_jobs() -> int:
    return await recover_incomplete_jobs_impl()
