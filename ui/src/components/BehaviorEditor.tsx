import { useState } from 'react';
import type { Behavior, Evaluation } from '../types';
import { newEvaluation } from '../types';
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

const ACTORS = [
  { key: 'user',      label: 'user',      colors: 'bg-blue-50 text-blue-600 ring-blue-200' },
  { key: 'assistant', label: 'assistant', colors: 'bg-violet-50 text-violet-600 ring-violet-200' },
  { key: 'tool',      label: 'tool',      colors: 'bg-amber-50 text-amber-600 ring-amber-200' },
  { key: 'system',    label: 'system',    colors: 'bg-slate-100 text-slate-500 ring-slate-200' },
  { key: 'human',     label: 'human',     colors: 'bg-emerald-50 text-emerald-600 ring-emerald-200' },
  { key: 'external',  label: 'external',  colors: 'bg-rose-50 text-rose-600 ring-rose-200' },
];

const ACTIONS: Record<string, string[]> = {
  Communication: ['says','asks','responds','informs','greets','clarifies','confirms','rejects','suggests','shows'],
  Execution:     ['calls','submits','retrieves','stores','updates'],
  Interaction:   ['selects','uploads','downloads','approves'],
  Delegation:    ['hands_off'],
};

const EVAL_TYPES = ['contains','exact_match','regex','schema','tool_call','llm_judge'];

export function BehaviorEditor({ behavior, onUpdate, onAddEvaluation, onRemoveEvaluation }: Props) {
  const [showEvalPicker, setShowEvalPicker] = useState(false);
  const isExec    = ['calls','submits','retrieves','stores','updates'].includes(behavior.action);
  const hasTarget = ['calls','submits','hands_off','selects','uploads','approves','shows'].includes(behavior.action);
  const hasContent = behavior.action !== 'calls';

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5 space-y-4">
          {/* ── Actor ── */}
          <div className="space-y-2">
            <Label className="text-[11px] font-medium text-slate-400 uppercase tracking-[0.05em]">Actor</Label>
            <div className="flex gap-2 flex-wrap">
              {ACTORS.map(({ key, label, colors }) => {
                const active = behavior.actor === key;
                return (
                  <button
                    key={key}
                    onClick={() => onUpdate({ actor: key })}
                    className={`px-4 py-1.5 text-[13px] font-medium rounded-lg border transition-all ${
                      active
                        ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                        : `${colors} border-current/20 hover:border-current/40`
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Action ── */}
          <div className="space-y-2">
            <Label className="text-[11px] font-medium text-slate-400 uppercase tracking-[0.05em]">Action</Label>
            <select
              value={behavior.action}
              onChange={(e) => onUpdate({ action: e.target.value })}
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-[13px] text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-100 focus:border-slate-300"
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
            <div className="space-y-2">
              <Label className="text-[11px] font-medium text-slate-400 uppercase tracking-[0.05em]">
                {isExec ? 'Tool / API' : behavior.action === 'hands_off' ? 'Recipient' : 'UI element'}
              </Label>
              <Input
                value={behavior.target || ''}
                onChange={(e) => onUpdate({ target: e.target.value })}
                placeholder={isExec ? 'Order MCP' : 'Appointment Options'}
                className="h-9 text-[13px]"
              />
            </div>
          )}

          {/* ── Content ── */}
          {hasContent && (
            <div className="space-y-2">
              <Label className="text-[11px] font-medium text-slate-400 uppercase tracking-[0.05em]">Content</Label>
              {typeof behavior.content === 'object' && behavior.content !== null ? (
                <Textarea
                  value={JSON.stringify(behavior.content ?? {}, null, 2)}
                  onChange={(e) => { try { onUpdate({ content: JSON.parse(e.target.value) }); } catch { onUpdate({ content: e.target.value }); } }}
                  className="font-mono text-[13px] h-24"
                  placeholder='{"key":"value"}'
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

          {/* ── Parameters ── */}
          {isExec && (
            <div className="space-y-2">
              <Label className="text-[11px] font-medium text-slate-400 uppercase tracking-[0.05em]">Parameters (with)</Label>
              <Textarea
                value={behavior.with ? JSON.stringify(behavior.with, null, 2) : ''}
                onChange={(e) => { try { onUpdate({ with: JSON.parse(e.target.value) }); } catch { onUpdate({ with: undefined }); } }}
                className="font-mono text-[13px] h-20"
                placeholder='{"orderId":"{{orderId}}"}'
              />
            </div>
          )}

          {/* ── Capture ── */}
          <div className="space-y-2">
            <Label className="text-[11px] font-medium text-slate-400 uppercase tracking-[0.05em]">Capture</Label>
            <Textarea
              value={behavior.capture ? JSON.stringify(behavior.capture, null, 2) : ''}
              onChange={(e) => { try { onUpdate({ capture: JSON.parse(e.target.value) }); } catch { onUpdate({ capture: undefined }); } }}
              className="font-mono text-[13px] h-16"
              placeholder='{"orderId":"12345"}'
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Evaluations ── */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-[11px] font-medium text-slate-400 uppercase tracking-[0.05em]">Evaluations</Label>
            {!showEvalPicker && (
              <button onClick={() => setShowEvalPicker(true)}
                className="text-[12px] text-slate-500 hover:text-slate-900 font-medium transition-colors flex items-center gap-1">
                <Plus size={14} /> Add
              </button>
            )}
          </div>

          {(behavior.evaluations || []).map((e, i) => (
            <EvaluationEditor key={i} evaluation={e}
              onChange={(u) => {
                const next = [...(behavior.evaluations || [])];
                next[i] = { ...next[i], ...u };
                onUpdate({ evaluations: next });
              }}
              onRemove={() => onRemoveEvaluation(i)} />
          ))}

          {showEvalPicker && (
            <div className="flex gap-1.5 flex-wrap">
              {EVAL_TYPES.map((t) => (
                <button key={t}
                  onClick={() => { onAddEvaluation(newEvaluation(t)); setShowEvalPicker(false); }}
                  className="px-2.5 py-1 text-[12px] rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors">
                  {t}
                </button>
              ))}
              <button onClick={() => setShowEvalPicker(false)}
                className="px-2 py-1 text-[12px] text-slate-400 hover:text-slate-600">cancel</button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
