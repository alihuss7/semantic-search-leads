"use client";
import type { TsnePoint } from "@/lib/types";

interface Props {
  point: TsnePoint;
  x: number;
  y: number;
}

export default function LeadTooltip({ point, x, y }: Props) {
  const firstName = (point.raw_data["First Name"] || "").trim();
  const lastName = (point.raw_data["Last Name"] || "").trim();
  const fullName = `${firstName} ${lastName}`.trim();
  const project = point.raw_data["Project"] ?? "";
  const leadId = point.raw_data["Lead ID"] ?? `#${point.id}`;
  const source = point.raw_data["Lead Source"] ?? "";
  const status = point.raw_data["Lead Status"] ?? "";

  return (
    <div
      className="absolute z-50 pointer-events-none bg-white border border-zinc-200 rounded-xl p-3 shadow-xl max-w-xs text-xs text-zinc-700 space-y-1.5 animate-in fade-in duration-150"
      style={{ left: x, top: y }}
    >
      {fullName && <p className="font-semibold text-zinc-900 text-sm">{fullName}</p>}
      {project && <p className="font-semibold text-zinc-900 text-sm">{project}</p>}
      <p className="text-zinc-500">Lead {leadId}</p>
      <div className="flex gap-2 flex-wrap">
        {source && <span className="bg-zinc-100 text-zinc-700 px-1.5 py-0.5 rounded border border-zinc-200">{source}</span>}
        {status && <span className="bg-zinc-100 text-zinc-700 px-1.5 py-0.5 rounded border border-zinc-200">{status}</span>}
      </div>
      <p className="text-zinc-600 leading-relaxed line-clamp-4">{point.story}</p>
    </div>
  );
}
