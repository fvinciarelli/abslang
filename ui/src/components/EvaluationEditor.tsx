import type { Evaluation } from '../types';
import { X } from 'lucide-react';

interface Props {
  evaluation: Evaluation;
  onChange: (updates: Partial<Evaluation>) => void;
  onRemove: () => void;
}

const sharedInput =
  'w-full text-[13px] border-none outline-none bg-transparent placeholder:text-slate-300';

export function EvaluationEditor({ evaluation, onChange, onRemove }: Props) {
  return (
    <div className="flex items-start gap-2 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white group">
      <span className="shrink-0 mt-[3px] text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded uppercase tracking-widest select-none">
        {evaluation.type}
      </span>

      <div className="flex-1 min-w-0">
        {evaluation.type === 'contains' || evaluation.type === 'exact_match' ? (
          <input type="text" value={evaluation.value || ''}
            onChange={(e) => onChange({ value: e.target.value })}
            placeholder={evaluation.type === 'contains' ? 'Substring…' : 'Exact text…'}
            className={sharedInput} />
        ) : evaluation.type === 'regex' ? (
          <input type="text" value={evaluation.pattern || ''}
            onChange={(e) => onChange({ pattern: e.target.value })}
            placeholder="Pattern…" className={sharedInput + ' font-mono'} />
        ) : evaluation.type === 'llm_judge' ? (
          <textarea value={evaluation.criteria || ''}
            onChange={(e) => onChange({ criteria: e.target.value })}
            placeholder="Criteria for the judge…"
            className={sharedInput + ' resize-none h-10'} />
        ) : evaluation.type === 'schema' ? (
          <textarea value={evaluation.schema ? JSON.stringify(evaluation.schema, null, 2) : ''}
            onChange={(e) => { try { onChange({ schema: JSON.parse(e.target.value) }); } catch {} }}
            placeholder='{"type":"object","required":["status"]}'
            className={sharedInput + ' resize-none h-10 font-mono'} />
        ) : evaluation.type === 'tool_call' ? (
          <input type="text" value={evaluation.target || ''}
            onChange={(e) => onChange({ target: e.target.value })}
            placeholder="Tool name…" className={sharedInput} />
        ) : evaluation.type === 'variable_consistency' ? (
          <input type="text" value={evaluation.variable || ''}
            onChange={(e) => onChange({ variable: e.target.value })}
            placeholder="Variable name…" className={sharedInput} />
        ) : (
          <span className="text-[13px] text-slate-400">{evaluation.type} evaluation</span>
        )}
      </div>

      <button onClick={onRemove}
        className="shrink-0 mt-[3px] text-slate-300 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100">
        <X size={14} />
      </button>
    </div>
  );
}
