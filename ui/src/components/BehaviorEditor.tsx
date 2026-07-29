import { useState } from 'react';
import type { Behavior, Evaluation } from '../types';
import { newEvaluation } from '../types';
import { Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { EvaluationEditor } from './EvaluationEditor';

interface Props {
  behavior: Behavior;
  onUpdate: (updates: Partial<Behavior>) => void;
  onAddEvaluation: (e: Evaluation) => void;
  onRemoveEvaluation: (idx: number) => void;
}

const ACTORS = [
  { key: 'user',      bg: 'bg-blue-50 hover:bg-blue-100', text: 'text-blue-700' },
  { key: 'assistant', bg: 'bg-violet-50 hover:bg-violet-100', text: 'text-violet-700' },
  { key: 'tool',      bg: 'bg-amber-50 hover:bg-amber-100', text: 'text-amber-700' },
  { key: 'system',    bg: 'bg-slate-100 hover:bg-slate-200', text: 'text-slate-600' },
  { key: 'human',     bg: 'bg-emerald-50 hover:bg-emerald-100', text: 'text-emerald-700' },
  { key: 'external',  bg: 'bg-rose-50 hover:bg-rose-100', text: 'text-rose-700' },
];

const ACTIONS: Record<string, string[]> = {
  Communication: ['says','asks','responds','informs','greets','clarifies','confirms','rejects','suggests','shows'],
  Execution:     ['calls','submits','retrieves','stores','updates'],
  Interaction:   ['selects','uploads','downloads','approves'],
  Delegation:    ['hands_off'],
};

const EVAL_TYPES = ['contains','exact_match','regex','schema','tool_call','llm_judge'];

const labelCls = "w-[100px] shrink-0 text-[11px] font-medium text-slate-400 uppercase tracking-[0.05em] pt-1.5 select-none";
const rowCls = "flex items-start gap-3 px-4 py-2.5 border-b border-slate-50 last:border-b-0";

export function BehaviorEditor({ behavior, onUpdate, onAddEvaluation, onRemoveEvaluation }: Props) {
  const [showEvalPicker, setShowEvalPicker] = useState(false);
  const isExec    = ['calls','submits','retrieves','stores','updates'].includes(behavior.action);
  const hasTarget = ['calls','submits','hands_off','selects','uploads','approves','shows'].includes(behavior.action);
  const hasContent = behavior.action !== 'calls';

  return (
    <div className="space-y-4">
      {/* ── Behavior Properties ── */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        {/* ── Actor ── */}
        <div className={rowCls}>
          <span className={labelCls}>Actor</span>
          <div className="flex gap-1.5 flex-wrap">
            {ACTORS.map(({ key, bg, text }) => (
              <button
                key={key}
                onClick={() => onUpdate({ actor: key })}
                className={`px-3 py-1 text-[12px] font-medium rounded-md border transition-colors ${
                  behavior.actor === key
                    ? `bg-slate-900 text-white border-slate-900`
                    : `${bg} ${text} border-transparent`
                }`}
              >
                {key}
              </button>
            ))}
          </div>
        </div>

        {/* ── Action ── */}
        <div className={rowCls}>
          <span className={labelCls}>Action</span>
          <select
            value={behavior.action}
            onChange={(e) => onUpdate({ action: e.target.value })}
            className="h-7 w-full max-w-[240px] rounded border border-slate-200 bg-white px-2 text-[12px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-100 focus:border-slate-300"
          >
            {Object.entries(ACTIONS).map(([cat, actions]) => (
              <optgroup key={cat} label={cat}>
                {actions.map((a) => <option key={a} value={a}>{a}</option>)}
              </optgroup>
            ))}
          </select>
        </div>

        {/* ── Target ── */}
        {hasTarget && (
          <div className={rowCls}>
            <span className={labelCls}>
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

        {/* ── Content ── */}
        {hasContent && (
          <div className={rowCls}>
            <span className={labelCls}>Content</span>
            {typeof behavior.content === 'object' && behavior.content !== null ? (
              <Textarea
                value={JSON.stringify(behavior.content ?? {}, null, 2)}
                onChange={(e) => { try { onUpdate({ content: JSON.parse(e.target.value) }); } catch { onUpdate({ content: e.target.value }); } }}
                className="font-mono text-[12px] h-20"
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

        {/* ── Parameters ── */}
        {isExec && (
          <div className={rowCls}>
            <span className={labelCls}>Parameters</span>
            <Textarea
              value={behavior.with ? JSON.stringify(behavior.with, null, 2) : ''}
              onChange={(e) => { try { onUpdate({ with: JSON.parse(e.target.value) }); } catch { onUpdate({ with: undefined }); } }}
              className="font-mono text-[12px] h-16"
              placeholder='{"orderId":"{{orderId}}"}'
            />
          </div>
        )}

        {/* ── Capture ── */}
        <div className={rowCls}>
          <span className={labelCls}>Capture</span>
          <Textarea
            value={behavior.capture ? JSON.stringify(behavior.capture, null, 2) : ''}
            onChange={(e) => { try { onUpdate({ capture: JSON.parse(e.target.value) }); } catch { onUpdate({ capture: undefined }); } }}
            className="font-mono text-[12px] h-14"
            placeholder='{"orderId":"12345"}'
          />
        </div>
      </div>

      {/* ── Evaluations ── */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className={rowCls}>
          <span className={labelCls}>Evaluations</span>
          <div className="flex-1 space-y-1.5">
            {(behavior.evaluations || []).map((e, i) => (
              <EvaluationEditor key={i} evaluation={e}
                onChange={(u) => {
                  const next = [...(behavior.evaluations || [])];
                  next[i] = { ...next[i], ...u };
                  onUpdate({ evaluations: next });
                }}
                onRemove={() => onRemoveEvaluation(i)} />
            ))}

            {showEvalPicker ? (
              <div className="flex gap-1 flex-wrap">
                {EVAL_TYPES.map((t) => (
                  <button key={t}
                    onClick={() => { onAddEvaluation(newEvaluation(t)); setShowEvalPicker(false); }}
                    className="px-2 py-0.5 text-[11px] rounded border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-colors">
                    {t}
                  </button>
                ))}
                <button onClick={() => setShowEvalPicker(false)}
                  className="px-2 py-0.5 text-[11px] text-slate-400 hover:text-slate-600">cancel</button>
              </div>
            ) : (
              <button onClick={() => setShowEvalPicker(true)}
                className="text-[11px] text-slate-400 hover:text-slate-700 font-medium flex items-center gap-1 transition-colors">
                <Plus size={12} /> Add evaluation
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
