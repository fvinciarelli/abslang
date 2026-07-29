import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { ACTOR_COLORS, PALETTE_ITEMS } from '../types';

interface Props {
  onAdd: (actor: string, action: string) => void;
}

const ICON_MAP: Record<string, string> = {
  says: '💬',
  asks: '❓',
  informs: '📢',
  greets: '👋',
  clarifies: '🔍',
  confirms: '✅',
  rejects: '❌',
  suggests: '💡',
  shows: '📋',
  calls: '⚡',
  submits: '📤',
  retrieves: '📥',
  stores: '💾',
  updates: '🔄',
  responds: '↩️',
  hands_off: '🤝',
  selects: '👆',
  uploads: '⬆️',
  downloads: '⬇️',
  approves: '👍',
};

export function AddBehaviorBar({ onAdd }: Props) {
  return (
    <Paper sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 2, py: 1.5 }}>
      <Typography
        variant="caption"
        sx={{
          fontWeight: 700,
          color: 'text.secondary',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          mr: 1,
          flexShrink: 0,
        }}
      >
        Add step
      </Typography>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flex: 1, flexWrap: 'wrap' }}>
        {PALETTE_ITEMS.map((item) => {
          const c = ACTOR_COLORS[item.actor];
          const emoji = ICON_MAP[item.action] || '•';
          return (
            <Tooltip
              key={`${item.actor}-${item.action}`}
              title={
                <Box sx={{ textAlign: 'center', py: 0.5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {item.label}
                  </Typography>
                  <Typography variant="caption" sx={{ opacity: 0.7 }}>
                    {item.actor} · {item.action}
                  </Typography>
                </Box>
              }
              placement="bottom"
              arrow
            >
              <IconButton
                onClick={() => onAdd(item.actor, item.action)}
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: 1.5,
                  border: '1px solid',
                  borderColor: 'divider',
                  fontSize: '1.125rem',
                  transition: 'all 0.15s',
                  '&:hover': {
                    borderColor: c.dot,
                    bgcolor: `${c.dot}14`,
                    transform: 'translateY(-1px)',
                    boxShadow: `0 4px 12px ${c.dot}30`,
                  },
                }}
              >
                {emoji}
              </IconButton>
            </Tooltip>
          );
        })}
      </Box>
    </Paper>
  );
}
