import type { Evaluation } from '../types';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  evaluation: Evaluation;
  onChange: (updates: Partial<Evaluation>) => void;
  onRemove: () => void;
}

export function EvaluationEditor({ evaluation, onChange, onRemove }: Props) {
  return (
    <div className="flex items-start gap-2 group">
      <span className="shrink-0 mt-1.5 text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded uppercase tracking-wider select-none">
        {evaluation.type}
      </span>

      <div className="flex-1 min-w-0">
        {evaluation.type === 'contains' || evaluation.type === 'exact_match' ? (
          <Input value={evaluation.value || ''}
            onChange={(e) => onChange({ value: e.target.value })}
            placeholder={evaluation.type === 'contains' ? 'Substring to find…' : 'Exact text…'}
            className="h-8 text-[13px]" />
        ) : evaluation.type === 'regex' ? (
          <Input value={evaluation.pattern || ''}
            onChange={(e) => onChange({ pattern: e.target.value })}
            placeholder="Regular expression…"
            className="h-8 text-[13px] font-mono" />
        ) : evaluation.type === 'llm_judge' ? (
          <Textarea value={evaluation.criteria || ''}
            onChange={(e) => onChange({ criteria: e.target.value })}
            placeholder="Criteria for the LLM judge…"
            className="text-[13px] min-h-[40px] py-1.5" />
        ) : evaluation.type === 'schema' ? (
          <Textarea value={evaluation.schema ? JSON.stringify(evaluation.schema, null, 2) : ''}
            onChange={(e) => { try { onChange({ schema: JSON.parse(e.target.value) }); } catch {} }}
            placeholder='{"type":"object","required":["status"]}'
            className="text-[13px] font-mono min-h-[40px] py-1.5" />
        ) : evaluation.type === 'tool_call' ? (
          <Input value={evaluation.target || ''}
            onChange={(e) => onChange({ target: e.target.value })}
            placeholder="Tool name…"
            className="h-8 text-[13px]" />
        ) : evaluation.type === 'variable_consistency' ? (
          <Input value={evaluation.variable || ''}
            onChange={(e) => onChange({ variable: e.target.value })}
            placeholder="Variable name…"
            className="h-8 text-[13px]" />
        ) : (
          <span className="text-[13px] text-slate-400">{evaluation.type} evaluation</span>
        )}
      </div>

      <button onClick={onRemove}
        className="shrink-0 mt-1.5 text-slate-300 hover:text-slate-500 transition-colors opacity-0 group-hover:opacity-100">
        <X size={14} />
      </button>
    </div>
  );
}
