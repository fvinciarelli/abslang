import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import LayersIcon from '@mui/icons-material/Layers';
import type { Behavior } from '../types';
import { BehaviorNode } from './BehaviorNode';

interface Props {
  behaviors: Behavior[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: (afterId?: string) => void;
}

export function BehaviorFlow({ behaviors, selectedId, onSelect, onRemove, onAdd }: Props) {
  return (
    <Paper>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 3,
          py: 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Behavior Flow
        </Typography>
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => onAdd(behaviors[behaviors.length - 1]?.id)}
        >
          Add Step
        </Button>
      </Box>

      <Box sx={{ p: 3 }}>
        {behaviors.length === 0 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 8 }}>
            <Box
              sx={{
                width: 56,
                height: 56,
                borderRadius: 3,
                bgcolor: 'primary.main',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: 0.12,
              }}
            >
              <LayersIcon sx={{ color: 'primary.main', fontSize: 28 }} />
            </Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'text.secondary' }}>
              No behaviors yet
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 320, textAlign: 'center' }}>
              Click a behavior in the left palette or &quot;Add Step&quot; to start building your agent session flow.
            </Typography>
          </Box>
        ) : (
          behaviors.map((b, idx) => (
            <BehaviorNode
              key={b.id}
              behavior={b}
              index={idx}
              isSelected={b.id === selectedId}
              isLast={idx === behaviors.length - 1}
              onSelect={() => onSelect(b.id)}
              onRemove={() => onRemove(b.id)}
              onAddAfter={() => onAdd(b.id)}
            />
          ))
        )}
      </Box>
    </Paper>
  );
}
