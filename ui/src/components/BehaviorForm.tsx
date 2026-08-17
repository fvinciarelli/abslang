import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import CloseIcon from '@mui/icons-material/Close';
import type { Behavior, Evaluation } from '../types';
import { newEvaluation, ACTOR_OPTIONS, ACTION_OPTIONS, ACTOR_COLORS } from '../types';

const EVAL_TYPES = [
  'contains', 'exact_match', 'regex', 'schema', 'tool_call', 'llm_judge',
  'Groundedness', 'Relevance', 'Coherence', 'Fluency',
  'HateUnfairness', 'Violence', 'Sexual', 'SelfHarm', 'custom',
];

const SCORING_TYPES = new Set([
  'llm_judge', 'Groundedness', 'Relevance', 'Coherence', 'Fluency',
  'HateUnfairness', 'Violence', 'Sexual', 'SelfHarm', 'custom',
]);

interface Props {
  behavior: Behavior;
  stepNumber?: number;
  onUpdate: (updates: Partial<Behavior>) => void;
  onAddEval: (e: Evaluation) => void;
  onRemoveEval: (idx: number) => void;
}

export function BehaviorForm({ behavior, stepNumber, onUpdate, onAddEval, onRemoveEval }: Props) {
  const isExec = ['calls', 'submits', 'retrieves', 'stores', 'updates'].includes(behavior.action);
  const hasTarget = isExec || ['hands_off', 'selects', 'uploads', 'approves'].includes(behavior.action);
  const hasContent = behavior.action !== 'calls';
  const contentValue =
    typeof behavior.content === 'object' && behavior.content !== null
      ? JSON.stringify(behavior.content, null, 2)
      : (behavior.content as string) || '';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: 1.5,
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: '0.8125rem',
          }}
        >
          {stepNumber ?? '?'}
        </Box>
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 700, textTransform: 'capitalize' }}>
            {behavior.action}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {behavior.actor} · Step {stepNumber}
          </Typography>
        </Box>
      </Box>

      {/* Actor */}
      <Box>
        <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.1em', mb: 1, display: 'block' }}>
          Actor
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {ACTOR_OPTIONS.map((actor) => {
            const active = behavior.actor === actor;
            const c = ACTOR_COLORS[actor] ?? ACTOR_COLORS.system;
            return (
              <Chip
                key={actor}
                label={actor}
                size="small"
                onClick={() => onUpdate({ actor })}
                variant={active ? 'filled' : 'outlined'}
                sx={{
                  textTransform: 'capitalize',
                  fontWeight: 600,
                  fontSize: '0.75rem',
                  bgcolor: active ? c.dot : undefined,
                  color: active ? 'white' : 'text.secondary',
                  borderColor: active ? c.dot : 'divider',
                  '&:hover': active ? { bgcolor: c.dot } : { borderColor: c.dot, color: c.dot },
                }}
              />
            );
          })}
        </Box>
      </Box>

      {/* Action */}
      <TextField
        select
        label="Action"
        size="small"
        value={behavior.action}
        onChange={(e) => onUpdate({ action: e.target.value })}
        helperText="The observable operation this step performs."
      >
        {Object.entries(ACTION_OPTIONS).map(([cat, actions]) => [
          <MenuItem key={cat} disabled sx={{ fontWeight: 700, fontSize: '0.75rem', opacity: 1 }}>
            {cat}
          </MenuItem>,
          ...actions.map((a) => (
            <MenuItem key={a.label} value={a.label} sx={{ pl: 3 }}>
              {a.label}
            </MenuItem>
          )),
        ])}
      </TextField>

      {/* Target */}
      {hasTarget && (
        <TextField
          label={isExec ? 'Tool / API' : behavior.action === 'hands_off' ? 'Recipient' : 'Target'}
          size="small"
          value={behavior.target || ''}
          onChange={(e) => onUpdate({ target: e.target.value })}
          placeholder={isExec ? 'Order MCP' : 'UI Element'}
        />
      )}

      {/* Content */}
      {hasContent && (
        <TextField
          label="Content"
          size="small"
          multiline
          minRows={3}
          maxRows={8}
          value={contentValue}
          onChange={(e) => {
            if (typeof behavior.content === 'object' && behavior.content !== null) {
              try { onUpdate({ content: JSON.parse(e.target.value) }); } catch { /* */ }
              return;
            }
            onUpdate({ content: e.target.value });
          }}
          placeholder={behavior.actor === 'user' ? 'What the user says…' : 'Assistant response…'}
        />
      )}

      {/* Parameters */}
      {isExec && (
        <TextField
          label="Parameters (with)"
          size="small"
          multiline
          minRows={2}
          maxRows={6}
          value={behavior.with ? JSON.stringify(behavior.with, null, 2) : ''}
          onChange={(e) => {
            try { onUpdate({ with: JSON.parse(e.target.value) }); } catch { onUpdate({ with: undefined }); }
          }}
          placeholder='{"orderId":"{{orderId}}"}'
          helperText="JSON payload sent when invoking the tool."
          slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: '0.75rem' } } }}
        />
      )}

      {/* Capture */}
      <TextField
        label="Capture Variables"
        size="small"
        multiline
        minRows={2}
        maxRows={6}
        value={behavior.capture ? JSON.stringify(behavior.capture, null, 2) : ''}
        onChange={(e) => {
          try { onUpdate({ capture: JSON.parse(e.target.value) }); } catch { onUpdate({ capture: undefined }); }
        }}
        placeholder='{"orderId":"12345"}'
        helperText="Map values for reuse as {{variable}} in later steps."
        slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: '0.75rem' } } }}
      />

      {/* Branching (v0.2) */}
      <Box>
        <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.1em', mb: 0.5, display: 'block' }}>
          Branching (v0.2)
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={!!behavior.optional}
              onChange={(e) => onUpdate({ optional: e.target.checked, requires: e.target.checked ? behavior.requires : undefined })}
              size="small"
            />
          }
          label={<Typography variant="body2">Optional — this step may or may not happen</Typography>}
        />
        {behavior.optional && (
          <TextField
            label="Requires (behavior id)"
            size="small"
            fullWidth
            value={behavior.requires || ''}
            onChange={(e) => onUpdate({ requires: e.target.value || undefined })}
            placeholder="ask_id"
            helperText="Only activate if this behavior matched."
            sx={{ mt: 1 }}
          />
        )}

        <TextField
          select
          label="Matches when"
          size="small"
          fullWidth
          value={behavior.matches_when?.type || 'none'}
          onChange={(e) => {
            const t = e.target.value;
            if (t === 'none') onUpdate({ matches_when: undefined });
            else onUpdate({ matches_when: { type: t } });
          }}
          helperText="Semantic criterion to decide if this step matched (overrides actor/action)."
          sx={{ mt: 1 }}
        >
          <MenuItem value="none">(none — match by actor + action)</MenuItem>
          <MenuItem value="llm_judge">llm_judge</MenuItem>
          <MenuItem value="contains">contains</MenuItem>
          <MenuItem value="regex">regex</MenuItem>
        </TextField>

        {behavior.matches_when?.type === 'llm_judge' && (
          <TextField
            label="Criteria"
            size="small"
            fullWidth
            multiline
            minRows={2}
            value={behavior.matches_when.criteria || ''}
            onChange={(e) => onUpdate({ matches_when: { ...behavior.matches_when!, criteria: e.target.value } })}
            placeholder="The agent is requesting the order ID"
            sx={{ mt: 1 }}
          />
        )}
        {behavior.matches_when?.type === 'contains' && (
          <TextField
            label="Value"
            size="small"
            fullWidth
            value={behavior.matches_when.value || ''}
            onChange={(e) => onUpdate({ matches_when: { ...behavior.matches_when!, value: e.target.value } })}
            placeholder="Substring to find…"
            sx={{ mt: 1 }}
          />
        )}
        {behavior.matches_when?.type === 'regex' && (
          <TextField
            label="Pattern"
            size="small"
            fullWidth
            value={behavior.matches_when.pattern || ''}
            onChange={(e) => onUpdate({ matches_when: { ...behavior.matches_when!, pattern: e.target.value } })}
            placeholder="^Order #\\d+"
            sx={{ mt: 1 }}
          />
        )}
      </Box>

      {/* Evaluations */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Evaluations
          </Typography>
          {(behavior.evaluations?.length ?? 0) > 0 && (
            <Chip
              label={`${behavior.evaluations?.length} rules`}
              size="small"
              sx={{ bgcolor: 'primary.main', color: 'white', fontWeight: 700, fontSize: '0.625rem', height: 22 }}
            />
          )}
        </Box>

        {(behavior.evaluations?.length ?? 0) > 0 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 1.5 }}>
            {behavior.evaluations!.map((ev, idx) => (
              <Box key={idx} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.25 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Chip
                    label={ev.type}
                    size="small"
                    sx={{
                      bgcolor: 'primary.main',
                      color: 'white',
                      fontWeight: 600,
                      fontSize: '0.625rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      height: 22,
                      flexShrink: 0,
                    }}
                  />
                  <Box sx={{ flex: 1 }} />
                  <IconButton size="small" onClick={() => onRemoveEval(idx)} sx={{ flexShrink: 0 }}>
                    <CloseIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Box>
                <EvalFields
                  ev={ev}
                  onChange={(u) => {
                    const next = [...(behavior.evaluations || [])];
                    next[idx] = { ...next[idx], ...u };
                    onUpdate({ evaluations: next });
                  }}
                />
              </Box>
            ))}
          </Box>
        )}

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {EVAL_TYPES.map((type) => (
            <Button
              key={type}
              size="small"
              variant="outlined"
              onClick={() => onAddEval(newEvaluation(type))}
              sx={{ fontSize: '0.6875rem', py: 0.5 }}
            >
              + {type}
            </Button>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

function EvalFields({ ev, onChange }: { ev: Evaluation; onChange: (u: Partial<Evaluation>) => void }) {
  const scoring = SCORING_TYPES.has(ev.type);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {ev.type === 'contains' || ev.type === 'exact_match' ? (
        <TextField size="small" fullWidth value={ev.value || ''} onChange={(e) => onChange({ value: e.target.value })} placeholder={ev.type === 'contains' ? 'Substring to find…' : 'Exact text…'} />
      ) : ev.type === 'regex' ? (
        <TextField size="small" fullWidth value={ev.pattern || ''} onChange={(e) => onChange({ pattern: e.target.value })} placeholder="Regex pattern…" />
      ) : ev.type === 'schema' ? (
        <TextField size="small" fullWidth value={ev.schema ? JSON.stringify(ev.schema) : ''} onChange={(e) => { try { onChange({ schema: JSON.parse(e.target.value) }); } catch { /* */ } }} placeholder='{"type":"object"}' />
      ) : ev.type === 'tool_call' ? (
        <TextField size="small" fullWidth value={ev.target || ''} onChange={(e) => onChange({ target: e.target.value })} placeholder="Target tool…" />
      ) : ev.type === 'llm_judge' ? (
        <TextField size="small" fullWidth multiline minRows={2} value={ev.criteria || ''} onChange={(e) => onChange({ criteria: e.target.value })} placeholder="Evaluation criteria…" />
      ) : ev.type === 'custom' ? (
        <>
          <TextField size="small" fullWidth value={ev.id || ''} onChange={(e) => onChange({ id: e.target.value })} placeholder="Evaluator id (e.g. azure.task_adherence)" />
          <TextField size="small" fullWidth multiline minRows={2} value={ev.criteria || ''} onChange={(e) => onChange({ criteria: e.target.value })} placeholder="Criteria / prompt…" />
        </>
      ) : ev.type === 'variable_consistency' ? (
        <TextField size="small" fullWidth value={ev.variable || ''} onChange={(e) => onChange({ variable: e.target.value })} placeholder="Variable name…" />
      ) : ['Groundedness', 'Relevance', 'Coherence', 'Fluency'].includes(ev.type) ? (
        <>
          {ev.type === 'Groundedness' || ev.type === 'Relevance' ? (
            <TextField size="small" fullWidth value={ev.query || ''} onChange={(e) => onChange({ query: e.target.value })} placeholder="query (e.g. user_asks.says)" />
          ) : null}
          {ev.type === 'Groundedness' ? (
            <TextField size="small" fullWidth value={ev.context || ''} onChange={(e) => onChange({ context: e.target.value })} placeholder="context (e.g. kb_result.responds)" />
          ) : null}
          <TextField size="small" fullWidth value={ev.response || ''} onChange={(e) => onChange({ response: e.target.value })} placeholder="response (self)" />
        </>
      ) : null}

      {scoring && (
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            size="small"
            label="Threshold"
            type="number"
            inputProps={{ min: 0, max: 1, step: 0.05 }}
            value={ev.threshold ?? ''}
            onChange={(e) => onChange({ threshold: e.target.value === '' ? undefined : Number(e.target.value) })}
            sx={{ width: 100 }}
          />
          <TextField
            size="small"
            label="Adapter"
            value={ev.adapter || ''}
            onChange={(e) => onChange({ adapter: e.target.value || undefined })}
            placeholder="azure / aws / google"
            sx={{ flex: 1 }}
          />
        </Box>
      )}
    </Box>
  );
}
