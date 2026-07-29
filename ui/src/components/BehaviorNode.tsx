import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DataObjectIcon from '@mui/icons-material/DataObject';
import BoltIcon from '@mui/icons-material/Bolt';
import type { Behavior } from '../types';
import { ACTOR_COLORS } from '../types';

interface Props {
  behavior: Behavior;
  index: number;
  isSelected: boolean;
  isLast: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onAddAfter: () => void;
}

export function BehaviorNode({ behavior, index, isSelected, isLast, onSelect, onRemove, onAddAfter }: Props) {
  const c = ACTOR_COLORS[behavior.actor] ?? ACTOR_COLORS.system;

  const contentPreview =
    typeof behavior.content === 'string'
      ? behavior.content
      : behavior.content
        ? JSON.stringify(behavior.content)
        : null;

  return (
    <Box sx={{ position: 'relative', pl: '52px' }}>
      {!isLast && (
        <Box
          sx={{
            position: 'absolute',
            left: 20,
            top: 44,
            width: 2,
            height: 'calc(100% + 12px)',
            background: 'linear-gradient(180deg, rgba(124,58,237,0.3), transparent)',
          }}
        />
      )}

      <Box
        onClick={onSelect}
        sx={{
          position: 'absolute',
          left: 0,
          top: 4,
          zIndex: 1,
          width: 40,
          height: 40,
          borderRadius: 1.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px solid',
          borderColor: isSelected ? 'primary.main' : 'divider',
          bgcolor: isSelected ? 'primary.main' : 'background.paper',
          color: isSelected ? 'primary.contrastText' : 'text.secondary',
          fontWeight: 700,
          fontSize: '0.8125rem',
          boxShadow: isSelected ? '0 4px 16px rgba(124,58,237,0.3)' : '0 1px 2px rgba(0,0,0,0.04)',
          cursor: 'pointer',
        }}
      >
        {index + 1}
      </Box>

      <Box
        onClick={onSelect}
        sx={{
          position: 'relative',
          mb: 1.5,
          p: 2.5,
          borderRadius: 2,
          border: '2px solid',
          borderColor: isSelected ? 'primary.light' : 'divider',
          bgcolor: isSelected ? 'rgba(124,58,237,0.02)' : 'background.paper',
          cursor: 'pointer',
          transition: 'all 0.15s',
          '&:hover': {
            borderColor: isSelected ? 'primary.light' : 'grey.300',
            boxShadow: isSelected ? undefined : '0 2px 8px rgba(0,0,0,0.04)',
            '& .node-actions': { opacity: 1 },
          },
        }}
      >
        {/* Hover actions */}
        <Box
          className="node-actions"
          sx={{
            position: 'absolute',
            right: 12,
            top: 12,
            display: 'flex',
            gap: 0.5,
            opacity: 0,
            transition: 'opacity 0.15s',
          }}
        >
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); onAddAfter(); }}
            sx={{ width: 28, height: 28, borderRadius: 1, bgcolor: 'grey.100', '&:hover': { bgcolor: 'primary.main', color: 'white' } }}
          >
            <AddIcon sx={{ fontSize: 16 }} />
          </IconButton>
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            sx={{ width: 28, height: 28, borderRadius: 1, bgcolor: 'grey.100', '&:hover': { bgcolor: 'error.main', color: 'white' } }}
          >
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>

        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, pr: 8 }}>
          <Chip
            label={behavior.actor}
            size="small"
            sx={{
              bgcolor: c.bg,
              color: c.text,
              fontWeight: 600,
              fontSize: '0.6875rem',
              height: 24,
              '& .MuiChip-label': { px: 1 },
            }}
          />
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {behavior.action}
          </Typography>
          {behavior.target && (
            <Chip
              label={behavior.target}
              size="small"
              variant="outlined"
              sx={{ fontWeight: 500, fontSize: '0.6875rem', height: 24 }}
            />
          )}
        </Box>

        {/* Content */}
        {contentPreview ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              pr: 6,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {contentPreview}
          </Typography>
        ) : (
          <Typography variant="body2" color="text.disabled" sx={{ pr: 6, fontStyle: 'italic' }}>
            No content
          </Typography>
        )}

        {/* Meta */}
        <Box sx={{ display: 'flex', gap: 3, mt: 1.5 }}>
          {behavior.evaluations?.length ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <CheckCircleIcon sx={{ fontSize: 14, color: 'primary.main' }} />
              <Typography variant="caption" sx={{ fontWeight: 600, color: 'primary.main' }}>
                {behavior.evaluations.length} rule{behavior.evaluations.length > 1 ? 's' : ''}
              </Typography>
            </Box>
          ) : null}
          {behavior.capture && Object.keys(behavior.capture).length > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <DataObjectIcon sx={{ fontSize: 14, color: 'text.secondary', opacity: 0.5 }} />
              <Typography variant="caption" sx={{ fontWeight: 500, color: 'text.secondary' }}>
                {Object.keys(behavior.capture).length} capture{Object.keys(behavior.capture).length > 1 ? 's' : ''}
              </Typography>
            </Box>
          )}
          {behavior.with && Object.keys(behavior.with).length > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <BoltIcon sx={{ fontSize: 14, color: 'text.secondary', opacity: 0.5 }} />
              <Typography variant="caption" sx={{ fontWeight: 500, color: 'text.secondary' }}>
                params
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
