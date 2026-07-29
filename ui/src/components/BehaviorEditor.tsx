import { useState } from 'react';
import type { Behavior, Evaluation } from '../types';
import { ACTOR_OPTIONS, newEvaluation } from '../types';
import { Plus } from 'lucide-react';
import { PropertySheet, PropertyRow } from './ui/property-sheet';
import { Select } from './ui/select';
import { EvaluationEditor } from './EvaluationEditor';
import { cn } from '../lib/utils';

interface Props {
  behavior: Behavior;
  onUpdate: (updates: Partial<Behavior>) => void;
  onAddEvaluation: (e: Evaluation) => void;
  onRemoveEvaluation: (idx: number) => void;
}

const ACTOR_STYLE: Record<string, string> = {
  user: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600',
  assistant: 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100 data-[state=active]:bg-violet-600 data-[state=active]:text-white data-[state=active]:border-violet-600',
  tool: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 data-[state=active]:bg-amber-600 data-[state=active]:text-white data-[state=active]:border-amber-600',
  system: 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100 data-[state=active]:bg-slate-600 data-[state=active]:text-white data-[state=active]:border-slate-600',
  human: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:border-emerald-600',
  external: 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100 data-[state=active]:bg-rose-600 data-[state=active]:text-white data-[state=active]:border-rose-600',
};

const ACTION_CATEGORIES: Record<string, string[]> = {
  Communication: ['says', 'asks', 'responds', 'informs', 'greets', 'clarifies', 'confirms', 'rejects', 'suggests', 'shows'],
  Execution: ['calls', 'submits', 'retrieves', 'stores', 'updates'],
  Interaction: ['selects', 'uploads', 'downloads', 'approves'],
  Delegation: ['hands_off'],
};

const EVAL_TYPES = ['contains', 'exact_match', 'regex', 'schema', 'tool_call', 'llm_judge'];

export function BehaviorEditor({ behavior, onUpdate, onAddEvaluation, onRemoveEvaluation }: Props) {
  const [showEvalPicker, setShowEvalPicker] = useState(false);
  const isExecution = ['calls', 'submits', 'retrieves', 'stores', 'updates'].includes(behavior.action);
  const showTarget = ['calls', 'submits', 'hands_off', 'selects', 'uploads', 'approves', 'shows'].includes(behavior.action);
  const showContent = behavior.action !== 'calls';

  return (
    <div className="space-y-6">
      {/* Actor */}
      <PropertySheet>
        <PropertyRow label="Actor">
          <div className="flex gap-1.5 flex-wrap">
            {ACTOR_OPTIONS.map((a) => (
              <button
                key={a}
                data-state={behavior.actor === a ? 'active' : 'inactive'}
                onClick={() => onUpdate({ actor: a })}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-sm font-medium border transition-all',
                  ACTOR_STYLE[a] || 'bg-slate-50 text-slate-700 border-slate-200'
                )}
              >
                {a}
              </button>
            ))}
          </div>
        </PropertyRow>

        {/* Action */}
        <PropertyRow label="Action">
          <Select value={behavior.action} onValueChange={(v) => onUpdate({ action: v })}>
            <Select.Trigger className="w-full">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {Object.entries(ACTION_CATEGORIES).map(([cat, actions]) => (
                <Select.Group key={cat}>
                  <div className="px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
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

        {/* Target */}
        {showTarget && (
          <PropertyRow label={isExecution ? 'Tool / API' : behavior.action === 'hands_off' ? 'Recipient' : 'UI Element'}>
            <input
              type="text"
              value={behavior.target || ''}
              onChange={(e) => onUpdate({ target: e.target.value })}
              placeholder={isExecution ? 'e.g. Order MCP' : 'e.g. Appointment Options'}
              className="w-full h-9 px-3 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 placeholder:text-slate-400"
            />
          </PropertyRow>
        )}

        {/* Content */}
        {showContent && (
          <PropertyRow label="Content">
            {typeof behavior.content === 'object' && behavior.content !== null ? (
              <textarea
                value={JSON.stringify(behavior.content, null, 2)}
                onChange={(e) => {
                  try { onUpdate({ content: JSON.parse(e.target.value) }); } catch { onUpdate({ content: e.target.value }); }
                }}
                className="w-full px-3 py-2 rounded-md border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 placeholder:text-slate-400 h-24 resize-y"
                placeholder='{"key": "value"}'
              />
            ) : (
              <textarea
                value={(behavior.content as string) || ''}
                onChange={(e) => onUpdate({ content: e.target.value })}
                className="w-full px-3 py-2 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 placeholder:text-slate-400 h-20 resize-y"
                placeholder={behavior.actor === 'user' ? 'What the user says...' : 'What the assistant responds...'}
              />
            )}
          </PropertyRow>
        )}

        {/* With */}
        {isExecution && (
          <PropertyRow label="Parameters">
            <textarea
              value={behavior.with ? JSON.stringify(behavior.with, null, 2) : ''}
              onChange={(e) => {
                try { onUpdate({ with: JSON.parse(e.target.value) }); } catch { onUpdate({ with: undefined }); }
              }}
              className="w-full px-3 py-2 rounded-md border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 placeholder:text-slate-400 h-20 resize-y"
              placeholder='{"orderId": "{{orderId}}"}'
            />
          </PropertyRow>
        )}

        {/* Capture */}
        <PropertyRow label="Capture">
          <textarea
            value={behavior.capture ? JSON.stringify(behavior.capture, null, 2) : ''}
            onChange={(e) => {
              try { onUpdate({ capture: JSON.parse(e.target.value) }); } catch { onUpdate({ capture: undefined }); }
            }}
            className="w-full px-3 py-2 rounded-md border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 placeholder:text-slate-400 h-16 resize-y"
            placeholder='{"orderId": "12345"}'
          />
        </PropertyRow>
      </PropertySheet>

      {/* Evaluations */}
      <PropertySheet>
        <PropertyRow label="Evaluations">
          <div className="space-y-2">
            {(behavior.evaluations || []).map((e, i) => (
              <EvaluationEditor
                key={i}
                evaluation={e}
                onChange={(updates) => {
                  const updated = [...(behavior.evaluations || [])];
                  updated[i] = { ...updated[i], ...updates };
                  onUpdate({ evaluations: updated });
                }}
                onRemove={() => onRemoveEvaluation(i)}
              />
            ))}

            {showEvalPicker ? (
              <div className="flex gap-1.5 flex-wrap p-2 bg-slate-50 rounded-lg border border-slate-200">
                {EVAL_TYPES.map((t) => (
                  <button
                    key={t}
                    onClick={() => { onAddEvaluation(newEvaluation(t)); setShowEvalPicker(false); }}
                    className="px-2.5 py-1 text-xs rounded-md border border-slate-200 bg-white hover:bg-indigo-50 hover:border-indigo-300 transition-colors text-slate-600"
                  >
                    {t}
                  </button>
                ))}
                <button
                  onClick={() => setShowEvalPicker(false)}
                  className="px-2.5 py-1 text-xs rounded-md text-slate-400 hover:text-slate-600"
                >
                  cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowEvalPicker(true)}
                className="inline-flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 font-medium"
              >
                <Plus size={14} /> Add evaluation
              </button>
            )}

            {(behavior.evaluations || []).length === 0 && !showEvalPicker && (
              <p className="text-xs text-slate-400">No evaluations yet.</p>
            )}
          </div>
        </PropertyRow>
      </PropertySheet>
    </div>
  );
}
