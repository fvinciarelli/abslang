import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import AddIcon from '@mui/icons-material/Add';
import type { Behavior } from '../types';
import { ACTOR_COLORS } from '../types';

interface Props {
  behaviors: Behavior[];
  selectedId: string | null;
  showTool: boolean;
  onToggleTool: () => void;
  onSelect: (id: string) => void;
  onAdd: (actor: string, action: string) => void;
}

const DEFAULT_COLOR = { dot: '#6b7280', bg: '#f9fafb', text: '#374151' };

export function SequenceView({ behaviors, selectedId, showTool, onToggleTool, onSelect, onAdd }: Props) {
  const lanes = showTool
    ? [
        { actor: 'user', label: 'User', action: 'says' },
        { actor: 'assistant', label: 'Assistant', action: 'says' },
        { actor: 'tool', label: 'Tool', action: 'responds' },
      ]
    : [
        { actor: 'user', label: 'User', action: 'says' },
        { actor: 'assistant', label: 'Assistant', action: 'says' },
      ];

  return (
    <Box sx={{ position: 'relative', height: '100%', overflow: 'auto', p: 2 }}>
      <Button
        size="small"
        onClick={onToggleTool}
        sx={{
          position: 'absolute',
          top: 8,
          right: 12,
          zIndex: 1,
          textTransform: 'none',
          color: 'text.secondary',
          fontSize: '0.7rem',
        }}
      >
        {showTool ? '− Hide tool lane' : '+ Tool lane'}
      </Button>

      <Box sx={{ display: 'flex', gap: 2, minWidth: 'min-content', height: '100%' }}>
        {lanes.map((lane) => {
          const laneBehaviors = behaviors.filter((b) => b.actor === lane.actor);
          const color = ACTOR_COLORS[lane.actor] ?? DEFAULT_COLOR;

          return (
            <Box key={lane.actor} sx={{ flex: 1, minWidth: 240, display: 'flex', flexDirection: 'column' }}>
              {/* Lane header */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, px: 1, py: 1 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color.dot }} />
                <Typography
                  variant="subtitle2"
                  sx={{
                    fontWeight: 700,
                    color: color.text,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    fontSize: '0.72rem',
                  }}
                >
                  {lane.label}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                  {laneBehaviors.length}
                </Typography>
              </Box>

              {/* Lane body */}
              <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1.5, overflowY: 'auto', pr: 0.5, pb: 2 }}>
                {laneBehaviors.map((b) => {
                  const stepNo = behaviors.indexOf(b) + 1;
                  const isSelected = b.id === selectedId;
                  const preview =
                    typeof b.content === 'string'
                      ? b.content
                      : b.content !== undefined && b.content !== null
                        ? JSON.stringify(b.content)
                        : '';

                  return (
                    <Paper
                      key={b.id}
                      elevation={0}
                      onClick={() => onSelect(b.id)}
                      sx={{
                        p: 1.5,
                        cursor: 'pointer',
                        borderRadius: 2,
                        border: '1px solid',
                        borderColor: isSelected ? color.dot : 'divider',
                        borderLeft: `3px solid ${color.dot}`,
                        bgcolor: isSelected ? color.bg : 'background.paper',
                        transition: 'box-shadow .15s ease, transform .15s ease',
                        '&:hover': { boxShadow: 2, transform: 'translateY(-1px)' },
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', fontFamily: 'monospace' }}>
                          {stepNo}. {b.action}
                          {b.target ? ` → ${b.target}` : ''}
                        </Typography>
                        {b.optional && (
                          <Chip label="optional" size="small" sx={{ height: 18, fontSize: '0.58rem' }} />
                        )}
                      </Box>

                      {preview && (
                        <Typography
                          variant="body2"
                          sx={{
                            color: 'text.primary',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            maxHeight: 64,
                            overflow: 'hidden',
                          }}
                        >
                          {preview}
                        </Typography>
                      )}

                      {(b.evaluations?.length ?? 0) > 0 && (
                        <Box sx={{ display: 'flex', gap: 0.5, mt: 1, flexWrap: 'wrap' }}>
                          {b.evaluations!.map((e, i) => (
                            <Chip
                              key={i}
                              label={e.type}
                              size="small"
                              variant="outlined"
                              sx={{ height: 18, fontSize: '0.58rem', color: 'text.secondary' }}
                            />
                          ))}
                        </Box>
                      )}
                    </Paper>
                  );
                })}

                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => onAdd(lane.actor, lane.action)}
                  sx={{
                    justifyContent: 'flex-start',
                    color: 'text.disabled',
                    textTransform: 'none',
                    borderRadius: 2,
                    border: '1px dashed',
                    borderColor: 'divider',
                    py: 0.75,
                  }}
                >
                  Add {lane.label.toLowerCase()} step
                </Button>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
