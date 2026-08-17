import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import type { ABSSession, Evaluation } from '../types';

const CHAIN_TYPES = [
  'sequence', 'eventually', 'never', 'count', 'within',
  'variable_consistency', 'all_of', 'any_of', 'none_of',
];

function defaultChainRule(type: string): any {
  switch (type) {
    case 'sequence':
      return { order: [{ actor: 'assistant', action: 'informs' }] };
    case 'eventually':
    case 'never':
      return { match: { actor: 'assistant', action: 'informs' } };
    case 'count':
      return { match: { actor: 'assistant', action: 'calls' }, min: 1 };
    case 'within':
      return {
        after: { actor: 'user', action: 'says' },
        match: { actor: 'assistant', action: 'responds' },
        max_steps: 3,
      };
    case 'variable_consistency':
      return { variable: 'orderId' };
    case 'all_of':
    case 'any_of':
    case 'none_of':
      return { evaluations: [] };
    default:
      return {};
  }
}

function ruleBody(e: Evaluation): any {
  const { type, ...rest } = e;
  return rest;
}

interface Props {
  session: ABSSession;
  onUpdate: (updates: Partial<ABSSession>) => void;
}

export function SessionPanel({ session, onUpdate }: Props) {
  const evals = session.evaluations ?? [];

  const updateDataset = (field: 'id' | 'path', value: string) => {
    const current = session.dataset ?? { id: '', path: '' };
    const next = { ...current, [field]: value };
    if (!next.id && !next.path) onUpdate({ dataset: undefined });
    else onUpdate({ dataset: next });
  };

  const updateEval = (idx: number, body: any) => {
    const next = [...evals];
    next[idx] = { type: next[idx].type, ...body };
    onUpdate({ evaluations: next });
  };

  const addEval = (type: string) => {
    onUpdate({ evaluations: [...evals, { type, ...defaultChainRule(type) }] });
  };

  const removeEval = (idx: number) => {
    onUpdate({ evaluations: evals.filter((_, i) => i !== idx) });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box>
        <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
          Session
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Applies to the whole conversation — dataset and chain evaluations.
        </Typography>
      </Box>

      {/* Dataset */}
      <Box>
        <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.1em', mb: 1, display: 'block' }}>
          Dataset
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            size="small"
            label="id"
            value={session.dataset?.id || ''}
            onChange={(e) => updateDataset('id', e.target.value)}
            placeholder="cases"
            helperText="Column prefix, e.g. {{cases.column}}"
            sx={{ width: 120 }}
          />
          <TextField
            size="small"
            label="path"
            value={session.dataset?.path || ''}
            onChange={(e) => updateDataset('path', e.target.value)}
            placeholder="cases.jsonl"
            sx={{ flex: 1 }}
          />
        </Box>
      </Box>

      {/* Chain evaluations */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Evaluations (whole session)
          </Typography>
          {evals.length > 0 && (
            <Chip label={`${evals.length} rules`} size="small" sx={{ bgcolor: 'primary.main', color: 'white', fontWeight: 700, fontSize: '0.625rem', height: 22 }} />
          )}
        </Box>

        {evals.map((e, i) => (
          <Box key={i} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.25, mb: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Chip
                label={e.type}
                size="small"
                sx={{ bgcolor: 'secondary.main', color: 'white', fontWeight: 600, fontSize: '0.625rem', textTransform: 'uppercase', height: 22 }}
              />
              <Box sx={{ flex: 1 }} />
              <IconButton size="small" onClick={() => removeEval(i)}>
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Box>
            <TextField
              size="small"
              fullWidth
              multiline
              minRows={2}
              maxRows={8}
              value={JSON.stringify(ruleBody(e), null, 2)}
              onChange={(ev) => {
                try { updateEval(i, JSON.parse(ev.target.value)); } catch { /* keep editing */ }
              }}
              slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: '0.72rem' } } }}
            />
          </Box>
        ))}

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {CHAIN_TYPES.map((type) => (
            <Button key={type} size="small" variant="outlined" onClick={() => addEval(type)} sx={{ fontSize: '0.6875rem', py: 0.5 }}>
              + {type}
            </Button>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
