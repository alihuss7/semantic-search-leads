"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import type { ClusterAlgorithm, TsnePoint } from "@/lib/types";
import { resolveLeadName } from "@/lib/leads";
import LeadTooltip from "./LeadTooltip";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

const CLUSTER_COLORS = [
  "#4e79a7","#f28e2b","#e15759","#76b7b2","#59a14f",
  "#edc948","#b07aa1","#ff9da7","#9c755f","#bab0ac",
  "#1f77b4","#ff7f0e","#2ca02c","#d62728","#9467bd",
  "#8c564b","#e377c2","#7f7f7f","#bcbd22","#17becf",
];
const NOISE_COLOR = "#cbd5e1";

function formatRelativeTime(isoTimestamp: string): string {
  const parsed = Date.parse(isoTimestamp);
  if (Number.isNaN(parsed)) return "just now";
  const seconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface Props {
  points: TsnePoint[];
  clusterAlgorithm: ClusterAlgorithm | null;
  highlightId: number | null;
  onRecompute: () => void;
  isLoading: boolean;
  isRecomputing: boolean;
  tsneComputedAt: string | null;
  tsneFromCache: boolean | null;
}

export default function ScatterPlot({
  points,
  clusterAlgorithm,
  highlightId,
  onRecompute,
  isLoading,
  isRecomputing,
  tsneComputedAt,
  tsneFromCache,
}: Props) {
  const [tooltip, setTooltip] = useState<{ point: TsnePoint; px: number; py: number } | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<TsnePoint | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const resolveClusterLabel = useCallback((point: TsnePoint): number => {
    if (point.cluster_label != null) return point.cluster_label;
    if (clusterAlgorithm === "kmeans" && point.kmeans_label != null) return point.kmeans_label;
    if (clusterAlgorithm === "hdbscan" && point.hdbscan_label != null) return point.hdbscan_label;
    return -1;
  }, [clusterAlgorithm]);

  const { traces } = useMemo(() => {
    if (!points.length) return { traces: [] };

    // Group by label
    const groups = new Map<number, TsnePoint[]>();
    for (const p of points) {
      const label = resolveClusterLabel(p);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(p);
    }

    const sortedLabels = Array.from(groups.keys()).sort((a, b) => a - b);

    const traces = sortedLabels.map((label) => {
      const pts = groups.get(label)!;
      const color = label === -1 ? NOISE_COLOR : CLUSTER_COLORS[label % CLUSTER_COLORS.length];
      const name = label === -1 ? "Noise" : `Cluster ${label}`;

      return {
        type: "scatter" as const,
        mode: "markers" as const,
        name,
        x: pts.map((p) => p.x),
        y: pts.map((p) => p.y),
        customdata: pts.map((p) => p.id),
        text: pts.map((p) => resolveLeadName(p.raw_data, p.id)),
        hoverinfo: "none" as const,
        marker: {
          size: pts.map((p) => (p.id === highlightId || p.id === selectedPoint?.id ? 14 : 7)),
          color: pts.map((p) => (p.id === highlightId ? "#111827" : color)),
          line: {
            width: pts.map((p) => (p.id === highlightId || p.id === selectedPoint?.id ? 2 : 0)),
            color: pts.map((p) => (p.id === selectedPoint?.id ? "#000000" : "#ffffff")),
          },
          opacity: 0.85,
        },
      };
    });

    return { traces };
  }, [points, highlightId, selectedPoint?.id, resolveClusterLabel]);

  const pointById = useMemo(() => new Map(points.map((p) => [p.id, p])), [points]);

  useEffect(() => {
    if (!isDetailOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsDetailOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDetailOpen]);

  const recomputeLabel = useMemo(() => {
    if (!tsneComputedAt) return "Recompute tSNE";
    const relative = formatRelativeTime(tsneComputedAt);
    return tsneFromCache ? `Recompute tSNE · cached ${relative}` : `Recompute tSNE · fresh ${relative}`;
  }, [tsneComputedAt, tsneFromCache]);

  function handleHover(event: Plotly.PlotHoverEvent) {
    const pt = event.points[0];
    const id = pt.customdata as number;
    const lead = pointById.get(id);
    if (!lead || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const nativeEvent = (event as unknown as { event: MouseEvent }).event;
    const pointerX = nativeEvent.clientX - rect.left;
    const pointerY = nativeEvent.clientY - rect.top;

    const TOOLTIP_WIDTH = 300;
    const TOOLTIP_HEIGHT = 180;
    const OFFSET = 12;
    const EDGE_GAP = 8;
    const shouldFlipHorizontally = pointerX + TOOLTIP_WIDTH + OFFSET > rect.width;

    const unclampedX = shouldFlipHorizontally
      ? pointerX - TOOLTIP_WIDTH - OFFSET
      : pointerX + OFFSET;
    const maxX = Math.max(EDGE_GAP, rect.width - TOOLTIP_WIDTH - EDGE_GAP);
    const px = Math.min(maxX, Math.max(EDGE_GAP, unclampedX));

    const maxY = Math.max(EDGE_GAP, rect.height - TOOLTIP_HEIGHT - EDGE_GAP);
    const py = Math.min(maxY, Math.max(EDGE_GAP, pointerY - 10));

    setTooltip({ point: lead, px, py });
  }

  function handleSelect(event: Plotly.PlotMouseEvent) {
    const pt = event.points?.[0];
    if (!pt) return;
    const id = pt.customdata as number;
    const lead = pointById.get(id);
    if (!lead) return;
    setSelectedPoint(lead);
  }

  return (
    <div ref={containerRef} className="relative h-full w-full min-h-[320px]">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10 rounded-xl">
          <div className="text-center space-y-2">
            <div className="w-8 h-8 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-zinc-500">Computing tSNE…</p>
          </div>
        </div>
      )}

      {points.length === 0 && !isLoading ? (
        <div className="flex items-center justify-center h-full text-zinc-500">
          <div className="text-center space-y-1">
            <p className="text-sm">No lead embeddings yet.</p>
            <p className="hidden text-sm font-medium text-zinc-700 lg:block">
              ← Use Import Leads in the sidebar to get started.
            </p>
            <p className="text-sm font-medium text-zinc-700 lg:hidden">
              Use Import Leads in the controls above to get started.
            </p>
          </div>
        </div>
      ) : (
        <Plot
          data={traces}
          layout={{
            paper_bgcolor: "transparent",
            plot_bgcolor: "#ffffff",
            font: { color: "#52525b", size: 11 },
            margin: { t: 30, r: 20, b: 40, l: 40 },
            showlegend: true,
            legend: {
              bgcolor: "#ffffff",
              bordercolor: "#e4e4e7",
              borderwidth: 1,
              font: { size: 11 },
            },
            xaxis: { showgrid: false, zeroline: false, showticklabels: false },
            yaxis: { showgrid: false, zeroline: false, showticklabels: false },
          }}
          config={{ displayModeBar: true, displaylogo: false, responsive: true }}
          style={{ width: "100%", height: "100%" }}
          onHover={handleHover}
          onUnhover={() => setTooltip(null)}
          onClick={handleSelect}
        />
      )}

      {tooltip && <LeadTooltip point={tooltip.point} x={tooltip.px} y={tooltip.py} />}

      {selectedPoint && (
        <div className="absolute bottom-3 left-3 right-3 z-20 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg sm:bottom-4 sm:left-4 sm:right-auto sm:max-w-sm">
          <p className="text-xs text-zinc-500">Selected lead</p>
          <p className="text-sm text-zinc-900 font-medium truncate">
            {resolveLeadName(selectedPoint.raw_data, selectedPoint.id)}
          </p>
          <p className="text-xs text-zinc-500 mt-0.5 truncate">
            {selectedPoint.raw_data["Project"] || "No project"}
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <button
              onClick={() => setIsDetailOpen(true)}
              className="w-full rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-800 sm:w-auto"
            >
              View details
            </button>
            <button
              onClick={() => { setSelectedPoint(null); setIsDetailOpen(false); }}
              className="w-full rounded-md border border-zinc-300 bg-zinc-100 px-3 py-1.5 text-xs text-zinc-700 transition-colors hover:bg-zinc-200 sm:w-auto"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {isDetailOpen && selectedPoint && (
        <div
          className="absolute inset-0 z-30 bg-white/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsDetailOpen(false);
          }}
        >
          <div className="flex w-full max-w-3xl max-h-[92%] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl sm:max-h-[88%]">
            <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3">
              <div className="min-w-0">
                <h3 className="text-zinc-900 font-semibold">
                  {resolveLeadName(selectedPoint.raw_data, selectedPoint.id)}
                </h3>
                <p className="truncate text-xs text-zinc-500">{selectedPoint.raw_data["Project"] || "No project"}</p>
                <p className="truncate text-xs text-zinc-500">
                  Lead #{selectedPoint.id}
                  {" · "}
                  {selectedPoint.cluster_algorithm ? `${selectedPoint.cluster_algorithm} ` : ""}
                  cluster {resolveClusterLabel(selectedPoint) === -1 ? "n/a" : resolveClusterLabel(selectedPoint)}
                </p>
              </div>
              <button
                onClick={() => setIsDetailOpen(false)}
                className="shrink-0 rounded-md border border-zinc-300 bg-zinc-100 px-3 py-1.5 text-xs text-zinc-700 transition-colors hover:bg-zinc-200"
              >
                Close
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div className="bg-zinc-100 rounded-md p-2">
                  <p className="text-zinc-500">Source</p>
                  <p className="text-zinc-800">{selectedPoint.raw_data["Lead Source"] || "n/a"}</p>
                </div>
                <div className="bg-zinc-100 rounded-md p-2">
                  <p className="text-zinc-500">Lead Status</p>
                  <p className="text-zinc-800">{selectedPoint.raw_data["Lead Status"] || "n/a"}</p>
                </div>
                <div className="bg-zinc-100 rounded-md p-2">
                  <p className="text-zinc-500">Contact Status</p>
                  <p className="text-zinc-800">
                    {selectedPoint.raw_data["Contact Status"] || selectedPoint.raw_data["Lead Status"] || "n/a"}
                  </p>
                </div>
                <div className="bg-zinc-100 rounded-md p-2">
                  <p className="text-zinc-500">Create Date</p>
                  <p className="text-zinc-800">
                    {selectedPoint.raw_data["Create Date"] || selectedPoint.raw_data["Created Date"] || "n/a"}
                  </p>
                </div>
              </div>

              <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500 mb-1">Narrative</p>
                <p className="text-sm text-zinc-800 leading-relaxed whitespace-pre-wrap">{selectedPoint.story}</p>
              </div>

              <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Raw lead data</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {Object.entries(selectedPoint.raw_data).map(([key, value]) => (
                    <div key={key} className="bg-white rounded-md p-2 border border-zinc-200">
                      <p className="text-[11px] text-zinc-500">{key}</p>
                      <p className="text-xs text-zinc-800 break-words">{value || "—"}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={onRecompute}
        disabled={isLoading || isRecomputing}
        className="absolute right-3 top-3 rounded-lg border border-zinc-900 bg-zinc-900 px-3 py-1.5 text-[11px] text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 sm:right-4 sm:top-auto sm:bottom-4 sm:text-xs"
      >
        {isRecomputing ? "Recomputing…" : recomputeLabel}
      </button>
    </div>
  );
}
