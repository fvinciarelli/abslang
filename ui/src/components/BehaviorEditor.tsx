import { useState } from 'react';
import type { Behavior, Evaluation } from '../types';
import { ACTOR_OPTIONS, ACTION_OPTIONS, newEvaluation } from '../types';
import { FiPlus } from 'react-icons/fi';
import { EvaluationEditor } from './EvaluationEditor';

interface Props {
  behavior: Behavior;
  onUpdate: (updates: Partial<Behavior>) => void;
  onAddEvaluation: (e: Evaluation) => void;
  onRemoveEvaluation: (idx: number) => void;
}

const ACTOR_COLORS: Record<string, string> = {
  user: 'bg-blue-100 text-blue-700 border-blue-200',
  assistant: 'bg-violet-100 text-violet-700 border-violet-200',
  tool: 'bg-amber-100 text-amber-700 border-amber-200',
  system: 'bg-slate-100 text-slate-700 border-slate-200',
  human: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  external: 'bg-rose-100 text-rose-700 border-rose-200',
};

export function BehaviorEditor({ behavior, onUpdate, onAddEvaluation, onRemoveEvaluation }: Props) {
  const [showEvalPicker, setShowEvalPicker] = useState(false);
  const isExecution = ['calls', 'submits', 'retrieves', 'stores', 'updates'].includes(behavior.action);
  const showTarget = ['calls', 'submits', 'hands_off', 'selects', 'uploads', 'approves', 'shows'].includes(behavior.action);

  return (
    <div className="space-y-5">
      {/* Actor row */}
      <div className="flex gap-3 items-center">
        <div className="flex-1">
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Actor</label>
          <div className="flex gap-1 flex-wrap">
            {ACTOR_OPTIONS.map((a) => (
              <button
                key={a}
                onClick={() => onUpdate({ actor: a })}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                  behavior.actor === a
                    ? `${ACTOR_COLORS[a]} border-2`
                    : 'border-slate-200 text-slate-500 hover:border-slate-300'
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Action selector */}
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1.5">Action</label>
        <div className="grid grid-cols-2 gap-1.5">
          {Object.entries(ACTION_OPTIONS).map(([category, actions]) => (
            <div key={category} className="space-y-1">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider px-1">{category}</div>
              {actions.map((a) => (
                <button
                  key={a.label}
                  onClick={() => onUpdate({ action: a.label })}
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-all ${
                    behavior.action === a.label
                      ? 'bg-accent text-white font-medium'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Target */}
      {showTarget && (
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">
            {isExecution ? 'Tool / API' : behavior.action === 'hands_off' ? 'Recipient' : 'UI Element'}
          </label>
          <input
            type="text"
            value={behavior.target || ''}
            onChange={(e) => onUpdate({ target: e.target.value })}
            placeholder={isExecution ? 'e.g. Order MCP' : 'e.g. Appointment Options'}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
          />
        </div>
      )}

      {/* Content */}
      {behavior.action !== 'calls' && (
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Content</label>
          {typeof behavior.content === 'object' && behavior.content !== null ? (
            <textarea
              value={JSON.stringify(behavior.content, null, 2)}
              onChange={(e) => {
                try {
                  onUpdate({ content: JSON.parse(e.target.value) });
                } catch {
                  onUpdate({ content: e.target.value });
                }
              }}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent h-24"
              placeholder='{"key": "value"}'
            />
          ) : (
            <textarea
              value={(behavior.content as string) || ''}
              onChange={(e) => onUpdate({ content: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent h-20"
              placeholder={behavior.actor === 'user' ? 'What the user says...' : 'What the assistant responds...'}
            />
          )}
        </div>
      )}

      {/* With */}
      {isExecution && (
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">
            Parameters (with)
          </label>
          <textarea
            value={behavior.with ? JSON.stringify(behavior.with, null, 2) : ''}
            onChange={(e) => {
              try {
                onUpdate({ with: JSON.parse(e.target.value) });
              } catch {
                onUpdate({ with: undefined });
              }
            }}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent h-20"
            placeholder='{"orderId": "{{orderId}}"}'
          />
        </div>
      )}

      {/* Capture */}
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1.5">
          Capture variables
        </label>
        <textarea
          value={behavior.capture ? JSON.stringify(behavior.capture, null, 2) : ''}
          onChange={(e) => {
            try {
              onUpdate({ capture: JSON.parse(e.target.value) });
            } catch {
              onUpdate({ capture: undefined });
            }
          }}
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent h-16"
          placeholder='{"orderId": "12345"}'
        />
      </div>

      {/* Evaluations */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-slate-500">Evaluations</label>
          <button
            onClick={() => setShowEvalPicker(!showEvalPicker)}
            className="text-xs text-accent hover:underline flex items-center gap-1"
          >
            <FiPlus size={12} /> Add
          </button>
        </div>

        {showEvalPicker && (
          <div className="mb-3 bg-slate-50 rounded-lg p-3 border border-slate-200">
            <div className="grid grid-cols-2 gap-1">
              {['contains', 'exact_match', 'regex', 'schema', 'tool_call', 'llm_judge'].map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    onAddEvaluation(newEvaluation(t));
                    setShowEvalPicker(false);
                  }}
                  className="text-left px-2 py-1.5 text-xs rounded hover:bg-white transition-colors text-slate-600"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}

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

        {(behavior.evaluations || []).length === 0 && (
          <p className="text-xs text-slate-400 py-2">No evaluations yet. Add one to verify this step.</p>
        )}
      </div>
    </div>
  );
}
