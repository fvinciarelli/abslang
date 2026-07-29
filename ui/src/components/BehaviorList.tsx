import type { Behavior } from '../types';
import { Trash2, Plus, GripVertical } from 'lucide-react';
import { cn } from '../lib/utils';

interface Props {
  behaviors: Behavior[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (fromIdx: number, toIdx: number) => void;
  onAdd: (afterId?: string) => void;
}

const ACTOR_DOT: Record<string, string> = {
  user: 'bg-blue-500',
  assistant: 'bg-violet-500',
  tool: 'bg-amber-500',
  system: 'bg-slate-500',
  human: 'bg-emerald-500',
  external: 'bg-rose-500',
};

export function BehaviorList({ behaviors, selectedId, onSelect, onRemove, onAdd }: Props) {
  return (
    <div className="py-1">
      {behaviors.map((b, idx) => {
        const isSelected = b.id === selectedId;
        const content = typeof b.content === 'string' ? b.content : b.content ? JSON.stringify(b.content) : '';

        return (
          <div
            key={b.id}
            onClick={() => onSelect(b.id)}
            className={cn(
              'group flex items-center gap-2.5 px-3 py-2.5 mx-2 rounded-lg cursor-pointer transition-all text-sm',
              isSelected
                ? 'bg-indigo-50 text-indigo-900 ring-1 ring-indigo-200'
                : 'hover:bg-slate-50 text-slate-700'
            )}
          >
            <GripVertical size={12} className="text-slate-300 opacity-0 group-hover:opacity-100 shrink-0 transition-opacity" />
            <span className="text-[11px] text-slate-400 w-4 shrink-0 tabular-nums text-right">
              {idx + 1}
            </span>
            <div className={cn('w-2 h-2 rounded-full shrink-0', ACTOR_DOT[b.actor] || 'bg-slate-400')} />
            <span className="text-xs text-slate-500 shrink-0 w-16 truncate">{b.action}</span>
            <span className="flex-1 text-xs text-slate-400 truncate">
              {content ? content.substring(0, 35) : ''}
            </span>
            {(b.evaluations?.length ?? 0) > 0 && (
              <span className="text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                {b.evaluations?.length}
              </span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(b.id); }}
              className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-all shrink-0"
            >
              <Trash2 size={12} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onAdd(b.id); }}
              className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-indigo-500 transition-all shrink-0"
            >
              <Plus size={14} />
            </button>
          </div>
        );
      })}

      {behaviors.length === 0 && (
        <div className="text-center py-12 text-slate-400 text-sm">
          <p className="mb-3">No steps yet</p>
          <button onClick={() => onAdd()} className="text-indigo-600 hover:text-indigo-700 font-medium text-xs">
            Add your first step
          </button>
        </div>
      )}

      {behaviors.length > 0 && (
        <button
          onClick={() => onAdd(behaviors[behaviors.length - 1]?.id)}
          className="w-[calc(100%-16px)] mx-2 mt-1 px-3 py-2 text-xs text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors flex items-center gap-1.5"
        >
          <Plus size={12} /> Add step
        </button>
      )}
    </div>
  );
}
