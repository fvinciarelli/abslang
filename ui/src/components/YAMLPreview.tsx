import { useMemo, useState } from 'react';
import * as yaml from 'js-yaml';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import CodeIcon from '@mui/icons-material/Code';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import type { ABSSession } from '../types';
import { behaviorToYAML } from '../types';

interface Props {
  session: ABSSession;
}

export function YAMLPreview({ session }: Props) {
  const [copied, setCopied] = useState(false);

  const yamlStr = useMemo(() => {
    if (session.behaviors.length === 0) return '# No behaviors defined yet\n';
    const doc: any = { session: session.session };
    if (session.description) doc.description = session.description;
    if (session.abs_version) doc.abs_version = session.abs_version;
    doc.behaviors = session.behaviors.map(behaviorToYAML);
    if (session.evaluations?.length) doc.evaluations = session.evaluations;
    return yaml.dump(doc, { indent: 2, lineWidth: -1, noRefs: true });
  }, [session]);

  const lines = yamlStr.split('\n').length;

  const handleCopy = () => {
    navigator.clipboard.writeText(yamlStr);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: 1.5,
            bgcolor: 'primary.main',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.12,
          }}
        >
          <CodeIcon sx={{ color: 'primary.main', fontSize: 20 }} />
        </Box>
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            Generated YAML
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Live output · {lines} lines
          </Typography>
        </Box>
      </Box>

      {/* Code block */}
      <Box
        sx={{
          borderRadius: 1.5,
          overflow: 'hidden',
          border: '1px solid #21262d',
          bgcolor: '#0d1117',
        }}
      >
        {/* Title bar */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 2,
            py: 1.5,
            bgcolor: '#161b22',
            borderBottom: '1px solid #21262d',
          }}
        >
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#f87171' }} />
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#fbbf24' }} />
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#34d399' }} />
          </Box>
          <Typography
            variant="caption"
            sx={{
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              color: '#8b949e',
            }}
          >
            {session.session.toLowerCase().replace(/\s+/g, '-')}.abs.yaml
          </Typography>
          <IconButton
            size="small"
            onClick={handleCopy}
            sx={{ color: '#8b949e', '&:hover': { color: '#e2e8f0', bgcolor: 'rgba(255,255,255,0.06)' } }}
          >
            {copied ? <CheckIcon sx={{ fontSize: 16, color: '#34d399' }} /> : <ContentCopyIcon sx={{ fontSize: 16 }} />}
          </IconButton>
        </Box>

        {/* Code */}
        <Box
          component="pre"
          sx={{
            m: 0,
            p: 2,
            maxHeight: '55vh',
            overflow: 'auto',
            fontSize: '0.75rem',
            lineHeight: 1.8,
            fontFamily: '"Roboto Mono", monospace',
            color: '#c9d1d9',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {yamlStr}
        </Box>
      </Box>
    </Box>
  );
}
