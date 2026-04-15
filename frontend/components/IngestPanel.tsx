"use client";
import { useState, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { useIngest } from "@/hooks/useIngest";
import { api } from "@/lib/api";

interface Props {
  onComplete?: () => void;
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default function IngestPanel({ onComplete }: Props) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [maxRows, setMaxRows] = useState<string>("50");
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { mutation, statusQuery, cancelMutation, clearJob } = useIngest();

  const job = statusQuery.data;
  const statusError = statusQuery.error as Error | null;
  const isRunning = !statusError && (job?.status === "queued" || job?.status === "running");
  const isTerminal = job?.status === "completed" || job?.status === "completed_with_errors" || job?.status === "failed" || job?.status === "cancelled";
  const progress = job && job.total_rows > 0
    ? Math.round((job.processed_rows / job.total_rows) * 100)
    : 0;
  const statusLabel =
    job?.status === "completed_with_errors" ? "completed w/errors" :
    job?.status === "cancelled" ? "cancelled" :
    job?.status;

  const calledComplete = useRef(false);
  useEffect(() => {
    const isDone = job?.status === "completed" || job?.status === "completed_with_errors";
    if (isDone && !calledComplete.current) {
      calledComplete.current = true;
      onComplete?.();
    }
    if (!isDone) {
      calledComplete.current = false;
    }
  }, [job?.status, onComplete]);

  const calledStatusError = useRef(false);
  useEffect(() => {
    if (statusError && !calledStatusError.current) {
      calledStatusError.current = true;
      toast.error(`Could not fetch ingest status: ${statusError.message}`);
    }
    if (!statusError) {
      calledStatusError.current = false;
    }
  }, [statusError]);

  async function handleIngest() {
    const parsedRows = parseInt(maxRows, 10);
    if (!Number.isFinite(parsedRows) || parsedRows < 2) {
      toast.error("Max rows must be at least 2");
      return;
    }

    try {
      await mutation.mutateAsync({
        file: selectedFile,
        max_rows: parsedRows,
      });
    } catch (e: unknown) {
      toast.error((e as Error).message ?? "Ingest failed");
    }
  }

  async function handleCancel() {
    if (!jobIdSafe) return;
    try {
      await cancelMutation.mutateAsync(jobIdSafe);
      toast.success("Cancellation requested");
    } catch (e: unknown) {
      toast.error((e as Error).message ?? "Could not cancel job");
    }
  }

  const jobIdSafe = job?.job_id ?? null;

  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-4 space-y-3 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-600 uppercase tracking-wider">Import Leads</h2>
        <button
          type="button"
          onClick={() => setIsCollapsed((v) => !v)}
          className="px-2 py-1 text-xs text-zinc-500 hover:text-zinc-700 rounded border border-zinc-200"
        >
          {isCollapsed ? "Show" : "Hide"}
        </button>
      </div>

      {!isCollapsed && (
        <>

      <label className="text-xs text-zinc-500 block">
        Optional CSV upload
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={isRunning}
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            setSelectedFile(file);
          }}
          className="mt-1 w-full block text-sm text-zinc-700 file:cursor-pointer file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-zinc-300 file:bg-zinc-100 file:text-zinc-700 hover:file:bg-zinc-200 disabled:opacity-50"
        />
      </label>

      <label className="text-xs text-zinc-500 block">
        Max rows
        <input
          type="number"
          min={2}
          value={maxRows}
          disabled={isRunning}
          onChange={(e) => setMaxRows(e.target.value)}
          className="mt-1 w-full bg-white border border-zinc-300 rounded-lg px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-500 disabled:opacity-50"
        />
      </label>

      <p className="text-xs text-zinc-500">
        {selectedFile
          ? `Selected: ${selectedFile.name}`
          : "Defaults to assets/Leads.csv"}
      </p>

      {isRunning ? (
        <button
          onClick={handleCancel}
          disabled={cancelMutation.isPending}
          className="w-full px-4 py-1.5 bg-zinc-600 hover:bg-zinc-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium text-white transition-colors"
        >
          {cancelMutation.isPending ? "Cancelling…" : "Cancel"}
        </button>
      ) : isTerminal ? (
        <button
          onClick={clearJob}
          className="w-full px-4 py-1.5 bg-zinc-900 hover:bg-zinc-800 rounded-lg text-sm font-medium text-white transition-colors"
        >
          New Ingest
        </button>
      ) : (
        <button
          onClick={handleIngest}
          disabled={mutation.isPending}
          className="w-full px-4 py-1.5 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium text-white transition-colors"
        >
          {mutation.isPending ? "Starting…" : "Ingest"}
        </button>
      )}

      {statusError && (
        <div className="bg-zinc-100 border border-zinc-300 rounded-lg p-3 text-xs text-zinc-700 space-y-2">
          <p>Ingest status polling stopped: {statusError.message}</p>
          <button
            onClick={clearJob}
            className="px-3 py-1 bg-zinc-900 hover:bg-zinc-800 rounded-md text-white transition-colors"
          >
            Clear stalled job
          </button>
        </div>
      )}

      {/* Progress section */}
      {job && (
        <div className="space-y-2 bg-zinc-50 border border-zinc-200 rounded-lg p-3">
          {/* Phase + status */}
          <div className="flex justify-between items-center">
            <span className="text-xs font-medium text-zinc-700">{job.phase}</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              job.status === "failed" ? "bg-zinc-300 text-zinc-800" :
              job.status === "cancelled" ? "bg-zinc-200 text-zinc-700" :
              job.status === "completed_with_errors" ? "bg-zinc-200 text-zinc-800" :
              job.status === "completed" ? "bg-zinc-900 text-white" :
              "bg-zinc-100 text-zinc-700"
            }`}>
              {job.status === "running" ? `${progress}%` : statusLabel}
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-2 bg-zinc-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${
                job.status === "failed" ? "bg-zinc-500" :
                job.status === "cancelled" ? "bg-zinc-400" :
                job.status === "completed_with_errors" ? "bg-zinc-600" :
                job.status === "completed" ? "bg-zinc-900" : "bg-zinc-700"
              }`}
              style={{ width: `${(job.status === "completed" || job.status === "completed_with_errors" || job.status === "cancelled") ? 100 : progress}%` }}
            />
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div className="text-zinc-500">Processed</div>
            <div className="text-zinc-700 text-right">
              {job.processed_rows.toLocaleString()} / {job.total_rows.toLocaleString()}
            </div>

            {job.failed_rows > 0 && (
              <>
                <div className="text-zinc-500">Failed</div>
                <div className="text-zinc-700 text-right">{job.failed_rows.toLocaleString()}</div>
              </>
            )}

            {(job.validation_failed_rows ?? 0) > 0 && (
              <>
                <div className="text-zinc-500">Validation failed</div>
                <div className="text-zinc-700 text-right">{(job.validation_failed_rows ?? 0).toLocaleString()}</div>
              </>
            )}

            {(job.processing_failed_rows ?? 0) > 0 && (
              <>
                <div className="text-zinc-500">Processing failed</div>
                <div className="text-zinc-700 text-right">{(job.processing_failed_rows ?? 0).toLocaleString()}</div>
              </>
            )}

            <div className="text-zinc-500">Elapsed</div>
            <div className="text-zinc-700 text-right">{formatTime(job.elapsed_seconds ?? 0)}</div>

            {job.eta_seconds != null && job.status === "running" && (
              <>
                <div className="text-zinc-500">ETA</div>
                <div className="text-zinc-700 text-right">{formatTime(job.eta_seconds)}</div>
              </>
            )}

            {(job.rows_per_second ?? 0) > 0 && (
              <>
                <div className="text-zinc-500">Speed</div>
                <div className="text-zinc-700 text-right">{job.rows_per_second ?? 0} rows/s</div>
              </>
            )}

            <div className="text-zinc-500">Max rows</div>
            <div className="text-zinc-700 text-right">{job.max_rows_requested}</div>
          </div>

          {job.has_validation_report && (
            <div className="text-xs space-y-2 bg-white border border-zinc-200 rounded-lg p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-700">
                  Validation report: {job.validation_failed_rows ?? 0} invalid row(s)
                </span>
                {jobIdSafe && (
                  <a
                    href={api.validationReportUrl(jobIdSafe)}
                    className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-white transition-colors"
                  >
                    Download CSV
                  </a>
                )}
              </div>
              {(job.validation_errors_preview ?? []).length > 0 && (
                <details>
                  <summary className="cursor-pointer text-zinc-600">Preview invalid rows</summary>
                  <div className="mt-1 max-h-32 overflow-y-auto space-y-1">
                    {(job.validation_errors_preview ?? []).map((item) => (
                      <p key={`${item.row_number}-${item.reason}`} className="text-zinc-600">
                        Row {item.row_number}: {item.reason}
                      </p>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {/* Errors */}
          {job.errors.length > 0 && (
            <details className="text-xs">
              <summary className="text-zinc-700 cursor-pointer">{job.errors.length} error(s)</summary>
              <div className="mt-1 max-h-24 overflow-y-auto space-y-1">
                {job.errors.slice(0, 10).map((err, i) => (
                  <p key={i} className="text-zinc-600 truncate">{err}</p>
                ))}
                {job.errors.length > 10 && (
                  <p className="text-zinc-500">…and {job.errors.length - 10} more</p>
                )}
              </div>
            </details>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}
