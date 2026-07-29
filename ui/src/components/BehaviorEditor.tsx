import { useState } from 'react';
import type { Behavior, Evaluation } from '../types';
import { ACTOR_OPTIONS, newEvaluation } from '../types';
import { Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { EvaluationEditor } from './EvaluationEditor';

interface Props {
  behavior: Behavior;
  onUpdate: (updates: Partial<Behavior>) => void;
  onAddEvaluation: (e: Evaluation) => void;
  onRemoveEvaluation: (idx: number) => void;
}

const ACTOR_COLOR: Record<string, string> = {
  user: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',
  assistant: 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100',
  tool: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
  system: 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200',
  human: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
  external: 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100',
};

const ACTION_GROUPS: Record<string, string[]> = {
  Communication: ['says', 'asks', 'responds', 'informs', 'greets', 'clarifies', 'confirms', 'rejects', 'suggests', 'shows'],
  Execution: ['calls', 'submits', 'retrieves', 'stores', 'updates'],
  Interaction: ['selects', 'uploads', 'downloads', 'approves'],
  Delegation: ['hands_off'],
};

const EVAL_TYPES = ['contains', 'exact_match', 'regex', 'schema', 'tool_call', 'llm_judge'];

export function BehaviorEditor({ behavior, onUpdate, onAddEvaluation, onRemoveEvaluation }: Props) {
  const [showEvalPicker, setShowEvalPicker] = useState(false);

  const isExec = ['calls', 'submits', 'retrieves', 'stores', 'updates'].includes(behavior.action);
  const hasTarget = ['calls', 'submits', 'hands_off', 'selects', 'uploads', 'approves', 'shows'].includes(behavior.action);
  const hasContent = behavior.action !== 'calls';

  return (
    <div className="space-y-4">
      {/* ── Behavior Properties ── */}
      <Card>
        <CardContent className="p-6 space-y-5">
          {/* Actor */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-slate-500">Actor</Label>
            <div className="flex gap-1.5 flex-wrap">
              {ACTOR_OPTIONS.map((a) => (
                <button
                  key={a}
                  onClick={() => onUpdate({ actor: a })}
                  className={`px-3 py-1.5 rounded-md text-[13px] font-medium border transition-all ${
                    behavior.actor === a
                      ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                      : (ACTOR_COLOR[a] || 'bg-slate-50 text-slate-600 border-slate-200')
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          {/* Action */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-slate-500">Action</Label>
            <select
              value={behavior.action}
              onChange={(e) => onUpdate({ action: e.target.value })}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {Object.entries(ACTION_GROUPS).map(([cat, actions]) => (
                <optgroup key={cat} label={cat}>
                  {actions.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Target */}
          {hasTarget && (
            <div className="space-y-2">
              <Label className="text-xs font-medium text-slate-500">
                {isExec ? 'Tool / API' : behavior.action === 'hands_off' ? 'Recipient' : 'UI Element'}
              </Label>
              <Input
                value={behavior.target || ''}
                onChange={(e) => onUpdate({ target: e.target.value })}
                placeholder={isExec ? 'Order MCP' : 'Appointment Options'}
              />
            </div>
          )}

          {/* Content */}
          {hasContent && (
            <div className="space-y-2">
              <Label className="text-xs font-medium text-slate-500">Content</Label>
              {typeof behavior.content === 'object' && behavior.content !== null ? (
                <Textarea
                  value={JSON.stringify(behavior.content ?? {}, null, 2)}
                  onChange={(e) => {
                    try { onUpdate({ content: JSON.parse(e.target.value) }); } catch { onUpdate({ content: e.target.value }); }
                  }}
                  className="font-mono text-[13px] h-24"
                  placeholder='{"key": "value"}'
                />
              ) : (
                <Textarea
                  value={(behavior.content as string) || ''}
                  onChange={(e) => onUpdate({ content: e.target.value })}
                  className="text-[13px] h-20"
                  placeholder={behavior.actor === 'user' ? 'What the user says…' : 'Assistant response…'}
                />
              )}
            </div>
          )}

          {/* Parameters */}
          {isExec && (
            <div className="space-y-2">
              <Label className="text-xs font-medium text-slate-500">Parameters (with)</Label>
              <Textarea
                value={behavior.with ? JSON.stringify(behavior.with, null, 2) : ''}
                onChange={(e) => {
                  try { onUpdate({ with: JSON.parse(e.target.value) }); } catch { onUpdate({ with: undefined }); }
                }}
                className="font-mono text-[13px] h-20"
                placeholder='{"orderId": "{{orderId}}"}'
              />
            </div>
          )}

          {/* Capture */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-slate-500">Capture</Label>
            <Textarea
              value={behavior.capture ? JSON.stringify(behavior.capture, null, 2) : ''}
              onChange={(e) => {
                try { onUpdate({ capture: JSON.parse(e.target.value) }); } catch { onUpdate({ capture: undefined }); }
              }}
              className="font-mono text-[13px] h-16"
              placeholder='{"orderId": "12345"}'
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Evaluations ── */}
      <Card>
        <CardContent className="p-6 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium text-slate-500">Evaluations</Label>
            {!showEvalPicker && (
              <button
                onClick={() => setShowEvalPicker(true)}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 font-medium transition-colors"
              >
                <Plus size={14} /> Add
              </button>
            )}
          </div>

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
            <div className="flex gap-1.5 flex-wrap pt-1">
              {EVAL_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => { onAddEvaluation(newEvaluation(t)); setShowEvalPicker(false); }}
                  className="px-2.5 py-1 text-[12px] rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors"
                >
                  {t}
                </button>
              ))}
              <button onClick={() => setShowEvalPicker(false)} className="px-2 py-1 text-[12px] text-slate-400 hover:text-slate-600">
                cancel
              </button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
