import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import CloseIcon from '@mui/icons-material/Close';
import type { Behavior, Evaluation } from '../types';
import { newEvaluation, ACTOR_OPTIONS, ACTION_OPTIONS, ACTOR_COLORS } from '../types';

const EVAL_TYPES = ['contains', 'exact_match', 'regex', 'schema', 'tool_call', 'llm_judge'];

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
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3.5 }}>
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
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 1.5 }}>
            {behavior.evaluations!.map((ev, idx) => (
              <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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
                    height: 24,
                    flexShrink: 0,
                  }}
                />
                <EvalField
                  ev={ev}
                  onChange={(u) => {
                    const next = [...(behavior.evaluations || [])];
                    next[idx] = { ...next[idx], ...u };
                    onUpdate({ evaluations: next });
                  }}
                />
                <IconButton size="small" onClick={() => onRemoveEval(idx)} sx={{ flexShrink: 0 }}>
                  <CloseIcon sx={{ fontSize: 16 }} />
                </IconButton>
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

function EvalField({
  ev,
  onChange,
}: {
  ev: Evaluation;
  onChange: (u: Partial<Evaluation>) => void;
}) {
  if (ev.type === 'contains' || ev.type === 'exact_match') {
    return (
      <TextField
        size="small"
        fullWidth
        value={ev.value || ''}
        onChange={(e) => onChange({ value: e.target.value })}
        placeholder={ev.type === 'contains' ? 'Substring to find…' : 'Exact text…'}
      />
    );
  }
  if (ev.type === 'regex') {
    return (
      <TextField
        size="small"
        fullWidth
        value={ev.pattern || ''}
        onChange={(e) => onChange({ pattern: e.target.value })}
        placeholder="Regex pattern…"
      />
    );
  }
  if (ev.type === 'llm_judge') {
    return (
      <TextField
        size="small"
        fullWidth
        value={ev.criteria || ''}
        onChange={(e) => onChange({ criteria: e.target.value })}
        placeholder="Evaluation criteria…"
      />
    );
  }
  if (ev.type === 'schema') {
    return (
      <TextField
        size="small"
        fullWidth
        value={ev.schema ? JSON.stringify(ev.schema) : ''}
        onChange={(e) => {
          try { onChange({ schema: JSON.parse(e.target.value) }); } catch { /* */ }
        }}
        placeholder='{"type":"object"}'
      />
    );
  }
  if (ev.type === 'tool_call') {
    return (
      <TextField
        size="small"
        fullWidth
        value={ev.target || ''}
        onChange={(e) => onChange({ target: e.target.value })}
        placeholder="Target tool…"
      />
    );
  }
  if (ev.type === 'variable_consistency') {
    return (
      <TextField
        size="small"
        fullWidth
        value={ev.variable || ''}
        onChange={(e) => onChange({ variable: e.target.value })}
        placeholder="Variable name…"
      />
    );
  }
  return <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>{ev.type} evaluation</Typography>;
}
