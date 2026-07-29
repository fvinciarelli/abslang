import type { Evaluation } from '../types';
import { X } from 'lucide-react';

interface Props {
  evaluation: Evaluation;
  onChange: (updates: Partial<Evaluation>) => void;
  onRemove: () => void;
}

export function EvaluationEditor({ evaluation, onChange, onRemove }: Props) {
  return (
    <div className="flex items-start gap-2 p-2.5 bg-white rounded-lg border border-slate-200">
      <span className="shrink-0 mt-0.5 text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded uppercase tracking-wider">
        {evaluation.type}
      </span>

      <div className="flex-1">
        {evaluation.type === 'contains' || evaluation.type === 'exact_match' ? (
          <input
            type="text"
            value={evaluation.value || ''}
            onChange={(e) => onChange({ value: e.target.value })}
            placeholder={evaluation.type === 'contains' ? 'Substring to find…' : 'Exact text…'}
            className="w-full text-sm border-none outline-none bg-transparent placeholder:text-slate-300"
          />
        ) : evaluation.type === 'regex' ? (
          <input
            type="text"
            value={evaluation.pattern || ''}
            onChange={(e) => onChange({ pattern: e.target.value })}
            placeholder="Regular expression…"
            className="w-full text-sm font-mono border-none outline-none bg-transparent placeholder:text-slate-300"
          />
        ) : evaluation.type === 'llm_judge' ? (
          <textarea
            value={evaluation.criteria || ''}
            onChange={(e) => onChange({ criteria: e.target.value })}
            placeholder="Criteria for the LLM judge…"
            className="w-full text-sm border-none outline-none bg-transparent placeholder:text-slate-300 resize-none h-12"
          />
        ) : evaluation.type === 'schema' ? (
          <textarea
            value={evaluation.schema ? JSON.stringify(evaluation.schema, null, 2) : ''}
            onChange={(e) => { try { onChange({ schema: JSON.parse(e.target.value) }); } catch {} }}
            placeholder='{"type":"object","required":["status"]}'
            className="w-full text-sm font-mono border-none outline-none bg-transparent placeholder:text-slate-300 resize-none h-12"
          />
        ) : evaluation.type === 'tool_call' ? (
          <input
            type="text"
            value={evaluation.target || ''}
            onChange={(e) => onChange({ target: e.target.value })}
            placeholder="Tool name…"
            className="w-full text-sm border-none outline-none bg-transparent placeholder:text-slate-300"
          />
        ) : evaluation.type === 'variable_consistency' ? (
          <input
            type="text"
            value={evaluation.variable || ''}
            onChange={(e) => onChange({ variable: e.target.value })}
            placeholder="Variable name…"
            className="w-full text-sm border-none outline-none bg-transparent placeholder:text-slate-300"
          />
        ) : (
          <span className="text-sm text-slate-400">{evaluation.type} evaluation</span>
        )}
      </div>

      <button onClick={onRemove} className="shrink-0 mt-0.5 text-slate-300 hover:text-red-400 transition-colors">
        <X size={14} />
      </button>
    </div>
  );
}
