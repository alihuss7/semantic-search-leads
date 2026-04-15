"use client";
import { useState, useCallback, useEffect } from "react";
import IngestPanel from "@/components/IngestPanel";
import ClusterControls from "@/components/ClusterControls";
import SearchBar from "@/components/SearchBar";
import ScatterPlot from "@/components/ScatterPlot";
import { useTsne } from "@/hooks/useTsne";
import { useQueryClient } from "@tanstack/react-query";
import type { ClusterAlgorithm, ClusterResponse } from "@/lib/types";

export default function Home() {
  const [clusterAlgorithm, setClusterAlgorithm] = useState<ClusterAlgorithm | null>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [hasData, setHasData] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const qc = useQueryClient();

  const { data: tsneData, isLoading, isFetching, recomputeTsne, isRecomputing } = useTsne(hasData);
  const points = tsneData?.points ?? [];
  const isTsneBlocking = hasData && (isLoading || (isFetching && points.length === 0));

  const handleIngestComplete = useCallback(() => {
    setHasData(true);
    setClusterAlgorithm(null);
    qc.invalidateQueries({ queryKey: ["tsne"] });
  }, [qc]);

  const handleClusterDone = useCallback((_result: ClusterResponse, alg: ClusterAlgorithm) => {
    setClusterAlgorithm(alg);
    qc.invalidateQueries({ queryKey: ["tsne"] });
  }, [qc]);

  const handleRecompute = useCallback(() => {
    recomputeTsne();
  }, [recomputeTsne]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setIsSidebarOpen(false);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!isSidebarOpen) return;
    if (window.matchMedia("(min-width: 1024px)").matches) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsSidebarOpen(false);
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isSidebarOpen]);

  const inferredClusterAlgorithm =
    clusterAlgorithm ?? points.find((p) => p.cluster_algorithm)?.cluster_algorithm ?? null;

  return (
    <div className="flex h-[100dvh] min-h-screen flex-col overflow-hidden bg-white">
      <header className="relative z-30 shrink-0 border-b border-zinc-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 px-3 py-3 sm:px-4">
          <h1 className="text-base font-semibold text-zinc-900">Lead Intelligence</h1>
          <button
            type="button"
            onClick={() => setIsSidebarOpen((v) => !v)}
            className="ml-auto rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 lg:hidden"
            aria-expanded={isSidebarOpen}
            aria-controls="controls-sidebar"
          >
            {isSidebarOpen ? "Close Controls" : "Controls"}
          </button>
          <div className="w-full lg:max-w-2xl">
            <SearchBar onSelectResult={setHighlightId} />
          </div>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <div
          className={`fixed inset-0 z-40 bg-black/25 transition-opacity lg:hidden ${
            isSidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          onClick={() => setIsSidebarOpen(false)}
        />

        <aside
          id="controls-sidebar"
          className={`fixed inset-y-0 left-0 z-50 flex w-[90vw] max-w-sm flex-col border-r border-zinc-200 bg-zinc-50 shadow-xl transition-transform duration-200 ease-out lg:static lg:z-10 lg:w-80 lg:max-w-none lg:translate-x-0 lg:shadow-none ${
            isSidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 lg:hidden">
            <p className="text-sm font-semibold text-zinc-800">Controls</p>
            <button
              type="button"
              onClick={() => setIsSidebarOpen(false)}
              className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
            >
              Close
            </button>
          </div>
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3 pb-6 sm:p-4">
            <IngestPanel onComplete={handleIngestComplete} />
            <ClusterControls onClusterDone={handleClusterDone} />
          </div>
        </aside>

        <main className="min-w-0 flex-1 bg-white p-3 sm:p-4 lg:min-h-0 lg:overflow-hidden">
          <div className="h-full min-h-[360px] w-full overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
            <ScatterPlot
              points={points}
              clusterAlgorithm={inferredClusterAlgorithm}
              highlightId={highlightId}
              onRecompute={handleRecompute}
              isLoading={isTsneBlocking}
              isRecomputing={isRecomputing}
              tsneComputedAt={tsneData?.computed_at ?? null}
              tsneFromCache={tsneData?.from_cache ?? null}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
