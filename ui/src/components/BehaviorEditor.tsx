import { useState } from 'react';
import type { Behavior, Evaluation } from '../types';
import { ACTOR_OPTIONS, newEvaluation } from '../types';
import { Plus } from 'lucide-react';
import { PropertySheet, PropertyRow } from './ui/property-sheet';
import { Select } from './ui/select';
import { EvaluationEditor } from './EvaluationEditor';

// ── Props ──

interface Props {
  behavior: Behavior;
  onUpdate: (updates: Partial<Behavior>) => void;
  onAddEvaluation: (e: Evaluation) => void;
  onRemoveEvaluation: (idx: number) => void;
}

// ── Actor pill colors ──

const ACTOR_COLOR: Record<string, { pill: string; dot: string }> = {
  user:      { pill: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' },
  assistant: { pill: 'bg-violet-50 text-violet-700 border-violet-200', dot: 'bg-violet-500' },
  tool:      { pill: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  system:    { pill: 'bg-slate-50 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
  human:     { pill: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  external:  { pill: 'bg-rose-50 text-rose-700 border-rose-200', dot: 'bg-rose-500' },
};

// ── Action groups for select ──

const ACTION_GROUPS: Record<string, string[]> = {
  Communication: ['says', 'asks', 'responds', 'informs', 'greets', 'clarifies', 'confirms', 'rejects', 'suggests', 'shows'],
  Execution:     ['calls', 'submits', 'retrieves', 'stores', 'updates'],
  Interaction:   ['selects', 'uploads', 'downloads', 'approves'],
  Delegation:    ['hands_off'],
};

const EVAL_TYPES = ['contains', 'exact_match', 'regex', 'schema', 'tool_call', 'llm_judge'];

// ── Component ──

export function BehaviorEditor({ behavior, onUpdate, onAddEvaluation, onRemoveEvaluation }: Props) {
  const [showEvalPicker, setShowEvalPicker] = useState(false);

  const isExec   = ['calls', 'submits', 'retrieves', 'stores', 'updates'].includes(behavior.action);
  const hasTarget = ['calls', 'submits', 'hands_off', 'selects', 'uploads', 'approves', 'shows'].includes(behavior.action);
  const hasContent = behavior.action !== 'calls';

  const inputClass =
    'w-full h-[34px] px-2.5 rounded-md border border-slate-200 text-[13px] text-slate-700 ' +
    'placeholder:text-slate-350 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 ' +
    'transition-shadow';

  const textareaClass =
    'w-full px-2.5 py-2 rounded-md border border-slate-200 text-[13px] text-slate-700 font-mono ' +
    'placeholder:text-slate-350 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 ' +
    'transition-shadow resize-y';

  return (
    <div className="space-y-6">
      <PropertySheet>
        {/* ── Actor ── */}
        <PropertyRow label="Actor">
          <div className="flex gap-1.5 flex-wrap">
            {ACTOR_OPTIONS.map((a) => {
              const c = ACTOR_COLOR[a] || ACTOR_COLOR.system;
              const active = behavior.actor === a;
              return (
                <button
                  key={a}
                  onClick={() => onUpdate({ actor: a })}
                  className={
                    `relative flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium border transition-all ` +
                    (active
                      ? `text-white border-transparent shadow-sm ${c.dot}`
                      : `${c.pill} hover:border-slate-300`)
                  }
                >
                  {active && <span className="w-1.5 h-1.5 rounded-full bg-white/40" />}
                  {a}
                </button>
              );
            })}
          </div>
        </PropertyRow>

        {/* ── Action ── */}
        <PropertyRow label="Action">
          <Select value={behavior.action} onValueChange={(v) => onUpdate({ action: v })}>
            <Select.Trigger className="w-full h-[34px] text-[13px]">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {Object.entries(ACTION_GROUPS).map(([cat, actions]) => (
                <Select.Group key={cat}>
                  <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                    {cat}
                  </div>
                  {actions.map((a) => (
                    <Select.Item key={a} value={a}>{a}</Select.Item>
                  ))}
                </Select.Group>
              ))}
            </Select.Content>
          </Select>
        </PropertyRow>

        {/* ── Target (conditional) ── */}
        {hasTarget && (
          <PropertyRow label={isExec ? 'Tool' : behavior.action === 'hands_off' ? 'Recipient' : 'UI Element'}>
            <input
              type="text"
              value={behavior.target || ''}
              onChange={(e) => onUpdate({ target: e.target.value })}
              placeholder={isExec ? 'Order MCP' : 'Appointment Options'}
              className={inputClass}
            />
          </PropertyRow>
        )}

        {/* ── Content (conditional) ── */}
        {hasContent && (
          <PropertyRow label="Content">
            {typeof behavior.content === 'object' && behavior.content !== null ? (
              <textarea
                value={JSON.stringify(behavior.content, null, 2)}
                onChange={(e) => {
                  try { onUpdate({ content: JSON.parse(e.target.value) }); } catch { onUpdate({ content: e.target.value }); }
                }}
                className={textareaClass + ' h-24'}
                placeholder='{"key": "value"}'
              />
            ) : (
              <textarea
                value={(behavior.content as string) || ''}
                onChange={(e) => onUpdate({ content: e.target.value })}
                className={textareaClass + ' h-[68px]'}
                placeholder={behavior.actor === 'user' ? 'What the user says…' : 'Assistant response…'}
              />
            )}
          </PropertyRow>
        )}

        {/* ── Parameters (execution only) ── */}
        {isExec && (
          <PropertyRow label="Parameters">
            <textarea
              value={behavior.with ? JSON.stringify(behavior.with, null, 2) : ''}
              onChange={(e) => {
                try { onUpdate({ with: JSON.parse(e.target.value) }); } catch { onUpdate({ with: undefined }); }
              }}
              className={textareaClass + ' h-[68px]'}
              placeholder='{"orderId": "{{orderId}}"}'
            />
          </PropertyRow>
        )}

        {/* ── Capture ── */}
        <PropertyRow label="Capture">
          <textarea
            value={behavior.capture ? JSON.stringify(behavior.capture, null, 2) : ''}
            onChange={(e) => {
              try { onUpdate({ capture: JSON.parse(e.target.value) }); } catch { onUpdate({ capture: undefined }); }
            }}
            className={textareaClass + ' h-[52px]'}
            placeholder='{"orderId": "12345"}'
          />
        </PropertyRow>
      </PropertySheet>

      {/* ── Evaluations ── */}
      <PropertySheet>
        <PropertyRow label="Evaluations">
          <div className="space-y-1.5">
            {(behavior.evaluations || []).map((e, i) => (
              <EvaluationEditor
                key={i}
                evaluation={e}
                onChange={(updates) => {
                  const next = [...(behavior.evaluations || [])];
                  next[i] = { ...next[i], ...updates };
                  onUpdate({ evaluations: next });
                }}
                onRemove={() => onRemoveEvaluation(i)}
              />
            ))}

            {showEvalPicker && (
              <div className="flex gap-1.5 flex-wrap">
                {EVAL_TYPES.map((t) => (
                  <button
                    key={t}
                    onClick={() => { onAddEvaluation(newEvaluation(t)); setShowEvalPicker(false); }}
                    className="px-2.5 py-1 text-[12px] rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 transition-colors"
                  >
                    {t}
                  </button>
                ))}
                <button onClick={() => setShowEvalPicker(false)} className="px-2 py-1 text-[12px] text-slate-400 hover:text-slate-600">
                  cancel
                </button>
              </div>
            )}

            {!showEvalPicker && (
              <button
                onClick={() => setShowEvalPicker(true)}
                className="inline-flex items-center gap-1 text-[12px] text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
              >
                <Plus size={14} /> Add evaluation
              </button>
            )}
          </div>
        </PropertyRow>
      </PropertySheet>
    </div>
  );
}
