import type { ReactNode } from "react";

// ── PropertySheet: container with single external border ──

export function PropertySheet({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      {children}
    </div>
  );
}

// ── PropertyRow: single row, no border overlap ──

export function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start border-b border-slate-100 last:border-b-0">
      <div className="w-[120px] shrink-0 px-4 py-[11px]">
        <span className="text-[11px] font-medium text-slate-400 uppercase tracking-[0.04em] leading-4">
          {label}
        </span>
      </div>
      <div className="flex-1 px-4 py-[9px] min-w-0">
        {children}
      </div>
    </div>
  );
}
