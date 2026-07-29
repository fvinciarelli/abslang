import type { Behavior } from '../types';
import { FiTrash2, FiPlus, FiMoreVertical } from 'react-icons/fi';

interface Props {
  behaviors: Behavior[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (fromIdx: number, toIdx: number) => void;
  onAdd: (afterId?: string) => void;
}

const ACTOR_COLORS: Record<string, string> = {
  user: 'bg-blue-100 text-blue-700',
  assistant: 'bg-violet-100 text-violet-700',
  tool: 'bg-amber-100 text-amber-700',
  system: 'bg-slate-100 text-slate-700',
  human: 'bg-emerald-100 text-emerald-700',
  external: 'bg-rose-100 text-rose-700',
};

export function BehaviorList({ behaviors, selectedId, onSelect, onRemove, onAdd }: Props) {
  return (
    <div className="py-2">
      {behaviors.map((b, idx) => {
        const isSelected = b.id === selectedId;
        const content =
          typeof b.content === 'string'
            ? b.content
            : b.content
              ? JSON.stringify(b.content)
              : '';

        return (
          <div
            key={b.id}
            onClick={() => onSelect(b.id)}
            className={`group flex items-center gap-2 px-3 py-2 mx-2 rounded-lg cursor-pointer transition-all text-sm ${
              isSelected
                ? 'bg-accent/10 text-accent-dark ring-1 ring-accent/20'
                : 'hover:bg-slate-50 text-slate-700'
            }`}
          >
            <FiMoreVertical size={12} className="text-slate-300 opacity-0 group-hover:opacity-100 shrink-0" />
            <span className="text-xs text-slate-400 w-5 shrink-0">{idx + 1}</span>
            <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium shrink-0 ${ACTOR_COLORS[b.actor] || 'bg-slate-100'}`}>
              {b.actor}
            </span>
            <span className="text-xs text-slate-500 shrink-0">{b.action}</span>
            <span className="flex-1 text-xs text-slate-400 truncate">
              {content ? `"${content.substring(0, 40)}"` : ''}
            </span>
            {(b.evaluations?.length ?? 0) > 0 && (
              <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1 rounded shrink-0">
                {b.evaluations?.length}
              </span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove(b.id);
              }}
              className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-all shrink-0"
            >
              <FiTrash2 size={12} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAdd(b.id);
              }}
              className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-accent transition-all shrink-0"
            >
              <FiPlus size={14} />
            </button>
          </div>
        );
      })}

      {behaviors.length === 0 && (
        <div className="text-center py-8 text-slate-400 text-sm">
          No behaviors yet.
          <br />
          <button
            onClick={() => onAdd()}
            className="text-accent hover:underline mt-1"
          >
            Add your first step
          </button>
        </div>
      )}

      {behaviors.length > 0 && (
        <button
          onClick={() => onAdd(behaviors[behaviors.length - 1]?.id)}
          className="w-full mt-2 mx-2 px-3 py-2 text-xs text-slate-400 hover:text-accent hover:bg-accent/5 rounded-lg transition-colors flex items-center gap-1.5"
          style={{ width: 'calc(100% - 16px)' }}
        >
          <FiPlus size={12} /> Add step
        </button>
      )}
    </div>
  );
}
