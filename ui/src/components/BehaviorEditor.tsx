import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { Behavior, Evaluation } from '../types';
import { newEvaluation } from '../types';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

// ── Constants ──

const ACTORS = [
  { key: 'user',      bg: 'bg-blue-50',       text: 'text-blue-700',  hover: 'hover:bg-blue-100' },
  { key: 'assistant', bg: 'bg-violet-50',     text: 'text-violet-700',hover: 'hover:bg-violet-100' },
  { key: 'tool',      bg: 'bg-amber-50',      text: 'text-amber-700', hover: 'hover:bg-amber-100' },
  { key: 'system',    bg: 'bg-slate-100',     text: 'text-slate-600', hover: 'hover:bg-slate-200' },
  { key: 'human',     bg: 'bg-emerald-50',    text: 'text-emerald-700',hover:'hover:bg-emerald-100' },
  { key: 'external',  bg: 'bg-rose-50',       text: 'text-rose-700',  hover: 'hover:bg-rose-100' },
] as const;

const ACTIONS: Record<string, string[]> = {
  Communication: ['says','asks','responds','informs','greets','clarifies','confirms','rejects','suggests','shows'],
  Execution:     ['calls','submits','retrieves','stores','updates'],
  Interaction:   ['selects','uploads','downloads','approves'],
  Delegation:    ['hands_off'],
};

const EVAL_OPTIONS = ['contains','exact_match','regex','schema','tool_call','llm_judge'] as const;

// ── Shared style tokens ──

const row       = 'flex items-start px-4 py-2.5 border-b border-slate-100 last:border-b-0';
const label     = 'w-[100px] shrink-0 pt-1 text-[11px] font-medium text-slate-400 uppercase tracking-[0.05em] select-none';
const inputSm   = 'h-7 w-full rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-700 placeholder:text-slate-350 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 transition-shadow';
const textareaSm = 'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[12px] text-slate-700 placeholder:text-slate-350 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 transition-shadow resize-y font-mono';

// ── Component ──

interface Props {
  behavior: Behavior;
  onUpdate: (updates: Partial<Behavior>) => void;
  onAddEvaluation: (e: Evaluation) => void;
  onRemoveEvaluation: (idx: number) => void;
}

export function BehaviorEditor({ behavior, onUpdate, onAddEvaluation, onRemoveEvaluation }: Props) {
  const [evalOpen, setEvalOpen] = useState(false);

  const isExec    = behavior.action === 'calls' || behavior.action === 'submits' || behavior.action === 'retrieves' || behavior.action === 'stores' || behavior.action === 'updates';
  const hasTarget = isExec || behavior.action === 'hands_off' || behavior.action === 'selects' || behavior.action === 'uploads' || behavior.action === 'approves' || behavior.action === 'shows';
  const hasContent = behavior.action !== 'calls';

  return (
    <div className="space-y-4">
      {/* ── Behavior Properties ── */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        {/* Actor */}
        <div className={row}>
          <span className={label}>Actor</span>
          <div className="flex gap-1.5 flex-wrap">
            {ACTORS.map(({ key, bg, text, hover }) => (
              <button
                key={key}
                onClick={() => onUpdate({ actor: key })}
                className={`px-3 py-1 text-[12px] font-medium rounded-md border transition-colors duration-150 ${
                  behavior.actor === key
                    ? 'bg-slate-900 text-white border-slate-900'
                    : `${bg} ${text} border-transparent ${hover}`
                }`}
              >
                {key}
              </button>
            ))}
          </div>
        </div>

        {/* Action */}
        <div className={row}>
          <span className={label}>Action</span>
          <select
            value={behavior.action}
            onChange={(e) => onUpdate({ action: e.target.value })}
            className={`${inputSm} max-w-[260px] cursor-pointer`}
          >
            {Object.entries(ACTIONS).map(([cat, actions]) => (
              <optgroup key={cat} label={cat}>
                {actions.map((a) => <option key={a} value={a}>{a}</option>)}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Target */}
        {hasTarget && (
          <div className={row}>
            <span className={label}>
              {isExec ? 'Tool / API' : behavior.action === 'hands_off' ? 'Recipient' : 'UI element'}
            </span>
            <Input
              value={behavior.target || ''}
              onChange={(e) => onUpdate({ target: e.target.value })}
              placeholder={isExec ? 'Order MCP' : 'Appointment Options'}
              className="h-7 text-[12px]"
            />
          </div>
        )}

        {/* Content */}
        {hasContent && (
          <div className={row}>
            <span className={label}>Content</span>
            {typeof behavior.content === 'object' && behavior.content !== null ? (
              <Textarea
                value={JSON.stringify(behavior.content ?? {}, null, 2)}
                onChange={(e) => { try { onUpdate({ content: JSON.parse(e.target.value) }); } catch { onUpdate({ content: e.target.value }); } }}
                className="text-[12px] h-20 font-mono"
                placeholder='{"key":"value"}'
              />
            ) : (
              <Textarea
                value={(behavior.content as string) || ''}
                onChange={(e) => onUpdate({ content: e.target.value })}
                className="text-[12px] h-16"
                placeholder={behavior.actor === 'user' ? 'What the user says…' : 'Assistant response…'}
              />
            )}
          </div>
        )}

        {/* Parameters */}
        {isExec && (
          <div className={row}>
            <span className={label}>Parameters</span>
            <Textarea
              value={behavior.with ? JSON.stringify(behavior.with, null, 2) : ''}
              onChange={(e) => { try { onUpdate({ with: JSON.parse(e.target.value) }); } catch { onUpdate({ with: undefined }); } }}
              className="text-[12px] h-16 font-mono"
              placeholder='{"orderId":"{{orderId}}"}'
            />
          </div>
        )}

        {/* Capture */}
        <div className={row}>
          <span className={label}>Capture</span>
          <Textarea
            value={behavior.capture ? JSON.stringify(behavior.capture, null, 2) : ''}
            onChange={(e) => { try { onUpdate({ capture: JSON.parse(e.target.value) }); } catch { onUpdate({ capture: undefined }); } }}
            className="text-[12px] h-14 font-mono"
            placeholder='{"orderId":"12345"}'
          />
        </div>
      </div>

      {/* ── Evaluations ── */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className={row}>
          <span className={label}>Evaluations</span>
          <div className="flex-1 space-y-1.5 min-w-0">
            {(behavior.evaluations || []).map((e, i) => (
              <EvaluationRow
                key={i}
                evaluation={e}
                onChange={(u) => {
                  const next = [...(behavior.evaluations || [])];
                  next[i] = { ...next[i], ...u };
                  onUpdate({ evaluations: next });
                }}
                onRemove={() => onRemoveEvaluation(i)}
              />
            ))}

            {evalOpen ? (
              <div className="flex gap-1 flex-wrap">
                {EVAL_OPTIONS.map((t) => (
                  <button
                    key={t}
                    onClick={() => { onAddEvaluation(newEvaluation(t)); setEvalOpen(false); }}
                    className="px-2 py-0.5 text-[11px] rounded border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-colors duration-150"
                  >
                    {t}
                  </button>
                ))}
                <button onClick={() => setEvalOpen(false)} className="px-2 py-0.5 text-[11px] text-slate-400 hover:text-slate-600 transition-colors duration-150">
                  cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setEvalOpen(true)}
                className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700 font-medium transition-colors duration-150"
              >
                <Plus size={12} /> Add evaluation
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Evaluation Row ──

function EvaluationRow({ evaluation, onChange, onRemove }: {
  evaluation: Evaluation;
  onChange: (u: Partial<Evaluation>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 group">
      <span className="shrink-0 text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded uppercase tracking-wider select-none">
        {evaluation.type}
      </span>
      <div className="flex-1 min-w-0">
        {evaluation.type === 'contains' || evaluation.type === 'exact_match' ? (
          <input
            type="text"
            value={evaluation.value || ''}
            onChange={(e) => onChange({ value: e.target.value })}
            placeholder={evaluation.type === 'contains' ? 'Substring…' : 'Exact text…'}
            className={inputSm + ' font-sans'}
          />
        ) : evaluation.type === 'regex' ? (
          <input
            type="text"
            value={evaluation.pattern || ''}
            onChange={(e) => onChange({ pattern: e.target.value })}
            placeholder="Pattern…"
            className={inputSm}
          />
        ) : evaluation.type === 'llm_judge' ? (
          <textarea
            value={evaluation.criteria || ''}
            onChange={(e) => onChange({ criteria: e.target.value })}
            placeholder="Criteria for the judge…"
            className={textareaSm + ' h-8 font-sans'}
            rows={1}
          />
        ) : evaluation.type === 'schema' ? (
          <textarea
            value={evaluation.schema ? JSON.stringify(evaluation.schema, null, 2) : ''}
            onChange={(e) => { try { onChange({ schema: JSON.parse(e.target.value) }); } catch {} }}
            placeholder='{"type":"object","required":["status"]}'
            className={textareaSm + ' h-8'}
            rows={1}
          />
        ) : evaluation.type === 'tool_call' ? (
          <input
            type="text"
            value={evaluation.target || ''}
            onChange={(e) => onChange({ target: e.target.value })}
            placeholder="Tool name…"
            className={inputSm + ' font-sans'}
          />
        ) : evaluation.type === 'variable_consistency' ? (
          <input
            type="text"
            value={evaluation.variable || ''}
            onChange={(e) => onChange({ variable: e.target.value })}
            placeholder="Variable name…"
            className={inputSm + ' font-sans'}
          />
        ) : (
          <span className="text-[12px] text-slate-400">{evaluation.type} evaluation</span>
        )}
      </div>
      <button
        onClick={onRemove}
        className="shrink-0 text-slate-300 hover:text-slate-500 transition-colors duration-150 opacity-0 group-hover:opacity-100"
      >
        <X size={14} />
      </button>
    </div>
  );
}
