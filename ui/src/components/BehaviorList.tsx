import type { Behavior } from '../types';
import { Trash2, Plus, GripVertical } from 'lucide-react';

interface Props {
  behaviors: Behavior[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (fromIdx: number, toIdx: number) => void;
  onAdd: (afterId?: string) => void;
}

const DOT: Record<string, string> = {
  user: 'bg-blue-500',
  assistant: 'bg-violet-500',
  tool: 'bg-amber-500',
  system: 'bg-slate-400',
  human: 'bg-emerald-500',
  external: 'bg-rose-500',
};

export function BehaviorList({ behaviors, selectedId, onSelect, onRemove, onAdd }: Props) {
  return (
    <div className="py-1">
      {behaviors.map((b, idx) => {
        const active = b.id === selectedId;
        const content = typeof b.content === 'string' ? b.content : '';

        return (
          <div
            key={b.id}
            onClick={() => onSelect(b.id)}
            className={
              'group flex items-center gap-2 px-3 py-2 mx-1.5 rounded-md cursor-pointer transition-colors text-[13px] select-none ' +
              (active
                ? 'bg-indigo-50 text-indigo-800'
                : 'hover:bg-slate-50 text-slate-600')
            }
          >
            {/* Drag handle */}
            <GripVertical size={11} className="text-slate-300 opacity-0 group-hover:opacity-100 shrink-0 transition-opacity" />

            {/* Step number */}
            <span className="text-[10px] text-slate-400 w-4 shrink-0 tabular-nums text-right font-medium">
              {idx + 1}
            </span>

            {/* Actor dot */}
            <span className={`w-[7px] h-[7px] rounded-full shrink-0 ${DOT[b.actor] || 'bg-slate-400'}`} />

            {/* Action name */}
            <span className="shrink-0 w-[72px] truncate text-slate-500 text-[12px]">
              {b.action}
            </span>

            {/* Content preview */}
            <span className="flex-1 truncate text-slate-400 text-[12px]">
              {content || ''}
            </span>

            {/* Eval count badge */}
            {(b.evaluations?.length ?? 0) > 0 && (
              <span className="text-[10px] font-medium text-indigo-500 bg-indigo-100 px-1.5 py-0.5 rounded-full shrink-0 leading-none">
                {b.evaluations?.length}
              </span>
            )}

            {/* Remove */}
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(b.id); }}
              className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-all shrink-0"
            >
              <Trash2 size={12} />
            </button>

            {/* Add after */}
            <button
              onClick={(e) => { e.stopPropagation(); onAdd(b.id); }}
              className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-indigo-500 transition-all shrink-0"
            >
              <Plus size={13} />
            </button>
          </div>
        );
      })}

      {/* Add step at bottom */}
      <button
        onClick={() => onAdd(behaviors[behaviors.length - 1]?.id)}
        className="w-[calc(100%-12px)] mx-1.5 mt-1 px-3 py-2 text-[12px] text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors flex items-center gap-1.5"
      >
        <Plus size={12} /> Add step
      </button>
    </div>
  );
}
