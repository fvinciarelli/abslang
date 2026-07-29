import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Avatar from '@mui/material/Avatar';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Chip from '@mui/material/Chip';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import type { Behavior } from '../types';
import { ACTOR_COLORS } from '../types';

interface Props {
  behaviors: Behavior[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const COLLAPSED = 56;
const EXPANDED = 240;

export function Sidebar({ behaviors, selectedId, onSelect }: Props) {
  const [open, setOpen] = useState(true);
  const width = open ? EXPANDED : COLLAPSED;

  const totalRules = behaviors.reduce((c, b) => c + (b.evaluations?.length ?? 0), 0);

  return (
    <Box
      sx={{
        width,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: '#0f1119',
        color: '#c8cdd8',
        borderRight: '1px solid',
        borderColor: 'rgba(255,255,255,0.06)',
        transition: 'width 0.2s ease',
        overflow: 'hidden',
      }}
    >
      {/* Brand + Toggle */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: open ? 'space-between' : 'center',
          px: open ? 2.5 : 1,
          py: 1.5,
          borderBottom: '1px solid',
          borderColor: 'rgba(255,255,255,0.06)',
          minHeight: 56,
        }}
      >
        {open ? (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Avatar
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: 1.5,
                  background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
                }}
              >
                <AutoAwesomeIcon sx={{ fontSize: 18 }} />
              </Avatar>
              <Box>
                <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.01em', lineHeight: 1.2 }}>
                  ABS Studio
                </Typography>
              </Box>
            </Box>
            <IconButton
              onClick={() => setOpen(false)}
              size="small"
              sx={{ color: '#5b6278', '&:hover': { color: '#e2e8f0', bgcolor: 'rgba(255,255,255,0.06)' } }}
            >
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
          </>
        ) : (
          <IconButton
            onClick={() => setOpen(true)}
            size="small"
            sx={{ color: '#5b6278', '&:hover': { color: '#e2e8f0', bgcolor: 'rgba(255,255,255,0.06)' } }}
          >
            <ChevronRightIcon fontSize="small" />
          </IconButton>
        )}
      </Box>

      {/* Session outline */}
      <Box sx={{ flex: 1, overflow: 'auto', px: open ? 1.5 : 0.5, pt: 1.5 }}>
        {open ? (
          <>
            <Box sx={{ px: 1.5, pb: 1.5 }}>
              <Typography
                sx={{
                  fontSize: '0.625rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.18em',
                  color: '#5b6278',
                  mb: 1,
                }}
              >
                Session Outline
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Chip
                  label={`${behaviors.length} steps`}
                  size="small"
                  sx={{ bgcolor: 'rgba(139,92,246,0.12)', color: '#c4b5fd', fontWeight: 600, fontSize: '0.6875rem', height: 22 }}
                />
                <Chip
                  label={`${totalRules} rules`}
                  size="small"
                  sx={{ bgcolor: 'rgba(255,255,255,0.04)', color: '#9ca3b4', fontWeight: 600, fontSize: '0.6875rem', height: 22 }}
                />
              </Box>
            </Box>

            {behaviors.length === 0 ? (
              <Typography sx={{ px: 1.5, fontSize: '0.75rem', color: '#5b6278', fontStyle: 'italic' }}>
                No steps yet
              </Typography>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                {behaviors.map((b, idx) => {
                  const c = ACTOR_COLORS[b.actor] ?? ACTOR_COLORS.system;
                  const isSelected = b.id === selectedId;
                  const preview =
                    typeof b.content === 'string' && b.content
                      ? b.content.slice(0, 30) + (b.content.length > 30 ? '…' : '')
                      : b.action;

                  return (
                    <ListItemButton
                      key={b.id}
                      onClick={() => onSelect(b.id)}
                      selected={isSelected}
                      sx={{
                        borderRadius: 1.5,
                        color: '#9ca3b4',
                        '&:hover': { bgcolor: 'rgba(255,255,255,0.04)', color: '#e2e8f0' },
                        '&.Mui-selected': {
                          bgcolor: 'rgba(139,92,246,0.12)',
                          color: '#c4b5fd',
                          '&:hover': { bgcolor: 'rgba(139,92,246,0.18)' },
                        },
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        <Box
                          sx={{
                            width: 24,
                            height: 24,
                            borderRadius: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            bgcolor: isSelected ? 'primary.main' : 'rgba(255,255,255,0.06)',
                            color: isSelected ? 'white' : c.dot,
                            fontWeight: 700,
                            fontSize: '0.6875rem',
                          }}
                        >
                          {idx + 1}
                        </Box>
                      </ListItemIcon>
                      <ListItemText
                        primary={preview}
                        secondary={`${b.actor} · ${b.action}`}
                        slotProps={{
                          primary: {
                            sx: {
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              color: isSelected ? '#e2e8f0' : '#c8cdd8',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            },
                          },
                          secondary: {
                            sx: {
                              fontSize: '0.625rem',
                              color: '#5b6278',
                              textTransform: 'capitalize',
                            },
                          },
                        }}
                      />
                      {b.evaluations?.length ? (
                        <CheckCircleIcon sx={{ fontSize: 12, color: 'primary.light', opacity: 0.6, flexShrink: 0 }} />
                      ) : null}
                    </ListItemButton>
                  );
                })}
              </Box>
            )}
          </>
        ) : (
          /* Collapsed: mini dots for each step */
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75, pt: 1 }}>
            {behaviors.map((b, idx) => {
              const c = ACTOR_COLORS[b.actor] ?? ACTOR_COLORS.system;
              const isSelected = b.id === selectedId;
              return (
                <Tooltip key={b.id} title={`Step ${idx + 1}: ${b.actor} · ${b.action}`} placement="right" arrow>
                  <Box
                    onClick={() => onSelect(b.id)}
                    sx={{
                      width: 28,
                      height: 28,
                      borderRadius: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: isSelected ? 'primary.main' : 'rgba(255,255,255,0.06)',
                      color: isSelected ? 'white' : c.dot,
                      fontWeight: 700,
                      fontSize: '0.625rem',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      '&:hover': { bgcolor: isSelected ? 'primary.main' : 'rgba(255,255,255,0.1)' },
                    }}
                  >
                    {idx + 1}
                  </Box>
                </Tooltip>
              );
            })}
          </Box>
        )}
      </Box>

      {/* Footer */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          px: open ? 2 : 1,
          py: 1,
          borderTop: '1px solid',
          borderColor: 'rgba(255,255,255,0.06)',
        }}
      >
        <Typography sx={{ fontSize: '0.625rem', color: '#5b6278' }}>
          {open ? `ABS v0.1 · ${behaviors.length} steps` : 'v0.1'}
        </Typography>
      </Box>
    </Box>
  );
}
