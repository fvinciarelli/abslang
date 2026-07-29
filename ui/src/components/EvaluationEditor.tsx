import type { Evaluation } from '../types';
import { FiTrash2 } from 'react-icons/fi';

interface Props {
  evaluation: Evaluation;
  onChange: (updates: Partial<Evaluation>) => void;
  onRemove: () => void;
}

export function EvaluationEditor({ evaluation, onChange, onRemove }: Props) {
  return (
    <div className="mb-2 p-3 bg-slate-50 rounded-lg border border-slate-200 text-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-accent bg-accent/10 px-2 py-0.5 rounded">
          {evaluation.type}
        </span>
        <button onClick={onRemove} className="text-slate-400 hover:text-red-500 transition-colors">
          <FiTrash2 size={12} />
        </button>
      </div>

      {evaluation.type === 'contains' || evaluation.type === 'exact_match' ? (
        <input
          type="text"
          value={evaluation.value || ''}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder={evaluation.type === 'contains' ? 'Substring to find...' : 'Exact text to match...'}
          className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-accent/30"
        />
      ) : evaluation.type === 'regex' ? (
        <input
          type="text"
          value={evaluation.pattern || ''}
          onChange={(e) => onChange({ pattern: e.target.value })}
          placeholder="Regular expression..."
          className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs font-mono focus:outline-none focus:ring-1 focus:ring-accent/30"
        />
      ) : evaluation.type === 'llm_judge' ? (
        <textarea
          value={evaluation.criteria || ''}
          onChange={(e) => onChange({ criteria: e.target.value })}
          placeholder="Natural language criteria for the judge..."
          className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-accent/30 h-16"
        />
      ) : evaluation.type === 'schema' ? (
        <textarea
          value={evaluation.schema ? JSON.stringify(evaluation.schema, null, 2) : ''}
          onChange={(e) => {
            try {
              onChange({ schema: JSON.parse(e.target.value) });
            } catch {}
          }}
          placeholder='{"type": "object", "required": ["status"]}'
          className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs font-mono focus:outline-none focus:ring-1 focus:ring-accent/30 h-16"
        />
      ) : evaluation.type === 'tool_call' ? (
        <div className="space-y-1.5">
          <input
            type="text"
            value={evaluation.target || ''}
            onChange={(e) => onChange({ target: e.target.value })}
            placeholder="Tool name"
            className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-accent/30"
          />
        </div>
      ) : evaluation.type === 'variable_consistency' ? (
        <input
          type="text"
          value={evaluation.variable || ''}
          onChange={(e) => onChange({ variable: e.target.value })}
          placeholder="Variable name"
          className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-accent/30"
        />
      ) : (
        <p className="text-xs text-slate-400">Configuration for {evaluation.type}</p>
      )}
    </div>
  );
}
