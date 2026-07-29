// ── ABS Types for the UI ──

export interface Behavior {
  id: string;
  actor: string;
  action: string;
  target?: string;
  content?: any;
  capture?: Record<string, string>;
  with?: Record<string, any>;
  with_only?: Record<string, any>;
  evaluations?: Evaluation[];
}

export interface Evaluation {
  type: string;
  value?: string;
  pattern?: string;
  criteria?: string;
  schema?: any;
  id?: string;
  ordered?: boolean;
  blocking?: boolean;
  match?: Selector;
  order?: Selector[];
  variable?: string;
  min?: number;
  max?: number;
  after?: Selector;
  max_steps?: number;
  target?: string;
  with?: Record<string, any>;
  evaluations?: Evaluation[];
}

export interface Selector {
  actor?: string;
  action?: string;
  target?: string;
}

export interface ABSFragment {
  name: string;
  behaviors: Behavior[];
}

export interface ABSSession {
  session: string;
  description?: string;
  abs_version?: string;
  behaviors: Behavior[];
  fragments?: Record<string, ABSFragment[]>;
  evaluations?: Evaluation[];
}

// ── Palette items for the sidebar ──

export const PALETTE_ITEMS = [
  { actor: 'user', action: 'says', label: 'User message' },
  { actor: 'assistant', action: 'says', label: 'Assistant says' },
  { actor: 'assistant', action: 'asks', label: 'Assistant asks' },
  { actor: 'assistant', action: 'informs', label: 'Assistant informs' },
  { actor: 'assistant', action: 'calls', label: 'Tool call' },
  { actor: 'tool', action: 'responds', label: 'Tool response' },
  { actor: 'assistant', action: 'hands_off', label: 'Hand-off' },
  { actor: 'user', action: 'selects', label: 'User selects' },
];

export const ACTOR_COLORS: Record<string, { dot: string; bg: string; text: string }> = {
  user: { dot: '#3b82f6', bg: '#eff6ff', text: '#1d4ed8' },
  assistant: { dot: '#8b5cf6', bg: '#f5f3ff', text: '#6d28d9' },
  tool: { dot: '#f59e0b', bg: '#fffbeb', text: '#b45309' },
  system: { dot: '#6b7280', bg: '#f9fafb', text: '#374151' },
  human: { dot: '#10b981', bg: '#ecfdf5', text: '#047857' },
  external: { dot: '#f43f5e', bg: '#fff1f2', text: '#be123c' },
};

// ── Action vocabulary ──

export const ACTOR_OPTIONS = ['user', 'assistant', 'tool', 'system', 'human', 'external'];

export const ACTION_OPTIONS: Record<string, { label: string; category: string }[]> = {
  Communication: [
    { label: 'says', category: 'Communication' },
    { label: 'asks', category: 'Communication' },
    { label: 'responds', category: 'Communication' },
    { label: 'informs', category: 'Communication' },
    { label: 'greets', category: 'Communication' },
    { label: 'clarifies', category: 'Communication' },
    { label: 'confirms', category: 'Communication' },
    { label: 'rejects', category: 'Communication' },
    { label: 'suggests', category: 'Communication' },
    { label: 'shows', category: 'Communication' },
  ],
  Execution: [
    { label: 'calls', category: 'Execution' },
    { label: 'submits', category: 'Execution' },
    { label: 'retrieves', category: 'Execution' },
    { label: 'stores', category: 'Execution' },
    { label: 'updates', category: 'Execution' },
  ],
  Interaction: [
    { label: 'selects', category: 'Interaction' },
    { label: 'uploads', category: 'Interaction' },
    { label: 'downloads', category: 'Interaction' },
    { label: 'approves', category: 'Interaction' },
  ],
  Delegation: [
    { label: 'hands_off', category: 'Delegation' },
  ],
};

export const EVAL_TYPE_OPTIONS = [
  { label: 'contains', desc: 'Text contains substring' },
  { label: 'exact_match', desc: 'Exact text match' },
  { label: 'regex', desc: 'Regular expression' },
  { label: 'schema', desc: 'JSON Schema validation' },
  { label: 'tool_call', desc: 'Tool call validation' },
  { label: 'llm_judge', desc: 'LLM-as-judge evaluation' },
  { label: 'sequence', desc: 'Steps in order' },
  { label: 'eventually', desc: 'Must occur at least once' },
  { label: 'never', desc: 'Must never occur' },
  { label: 'count', desc: 'Count occurrences' },
  { label: 'within', desc: 'Must occur within N steps' },
  { label: 'variable_consistency', desc: 'Variable value consistency' },
];

// ── Helpers ──

let _idCounter = 1;
export function newId(): string {
  return `b${_idCounter++}`;
}

export function newBehavior(actor = 'assistant', action = 'says'): Behavior {
  return {
    id: newId(),
    actor,
    action,
    content: '',
  };
}

export function newEvaluation(type = 'contains'): Evaluation {
  const base: Evaluation = { type };
  switch (type) {
    case 'contains':
    case 'exact_match':
      base.value = '';
      break;
    case 'regex':
      base.pattern = '';
      break;
    case 'llm_judge':
      base.criteria = '';
      break;
    case 'schema':
      base.schema = { type: 'object', required: [], properties: {} };
      break;
    case 'tool_call':
      base.target = '';
      base.with = {};
      break;
    case 'sequence':
      base.order = [];
      break;
    case 'eventually':
    case 'never':
    case 'count':
      base.match = {};
      break;
    case 'within':
      base.after = {};
      base.match = {};
      base.max_steps = 3;
      break;
    case 'variable_consistency':
      base.variable = '';
      break;
  }
  return base;
}

export function behaviorToYAML(b: Behavior): any {
  const y: any = {
    actor: b.actor,
    action: b.action,
  };
  if (b.target) y.target = b.target;
  if (b.content !== undefined && b.content !== '') y.content = b.content;
  if (b.capture && Object.keys(b.capture).length > 0) y.capture = b.capture;
  if (b.with && Object.keys(b.with).length > 0) y.with = b.with;
  if (b.with_only && Object.keys(b.with_only).length > 0) y.with_only = b.with_only;
  if (b.evaluations && b.evaluations.length > 0) {
    y.evaluations = b.evaluations.map((e) => {
      const ey: any = { type: e.type };
      for (const [k, v] of Object.entries(e)) {
        if (k !== 'type' && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0) && !(typeof v === 'object' && v !== null && Object.keys(v).length === 0)) {
          ey[k] = v;
        }
      }
      return ey;
    });
  }
  return y;
}
