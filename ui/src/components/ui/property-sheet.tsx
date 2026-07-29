import { cn } from "../../lib/utils";

interface PropertyRowProps {
  label: string;
  children: React.ReactNode;
  className?: string;
}

export function PropertyRow({ label, children, className }: PropertyRowProps) {
  return (
    <div className={cn("flex items-start gap-4 py-3 px-4 border-b border-slate-100 last:border-b-0", className)}>
      <label className="w-28 shrink-0 pt-2 text-xs font-medium text-slate-500 uppercase tracking-wider">
        {label}
      </label>
      <div className="flex-1">
        {children}
      </div>
    </div>
  );
}

interface PropertySheetProps {
  children: React.ReactNode;
  className?: string;
}

export function PropertySheet({ children, className }: PropertySheetProps) {
  return (
    <div className={cn("bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm", className)}>
      {children}
    </div>
  );
}
