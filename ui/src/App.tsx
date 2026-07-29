import { useState, useCallback } from 'react';
import * as yaml from 'js-yaml';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Chip from '@mui/material/Chip';
import SettingsIcon from '@mui/icons-material/Settings';
import CodeIcon from '@mui/icons-material/Code';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { AddBehaviorBar } from './components/AddBehaviorBar';
import { BehaviorFlow } from './components/BehaviorFlow';
import { BehaviorForm } from './components/BehaviorForm';
import { YAMLPreview } from './components/YAMLPreview';
import { useSession } from './hooks/useSession';
import { behaviorToYAML, newId } from './types';

export default function App() {
  const s = useSession();
  const [tab, setTab] = useState(0);

  const selectedIndex = s.selectedId
    ? s.session.behaviors.findIndex((b) => b.id === s.selectedId) + 1
    : null;

  const totalEvals = s.session.behaviors.reduce((c, b) => c + (b.evaluations?.length ?? 0), 0);

  const handleExport = useCallback(() => {
    const doc: any = { session: s.session.session };
    if (s.session.description) doc.description = s.session.description;
    if (s.session.abs_version) doc.abs_version = s.session.abs_version;
    doc.behaviors = s.session.behaviors.map(behaviorToYAML);
    if (s.session.evaluations?.length) doc.evaluations = s.session.evaluations;
    const str = yaml.dump(doc, { indent: 2, lineWidth: -1, noRefs: true });
    const blob = new Blob([str], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${s.session.session.toLowerCase().replace(/\s+/g, '-')}.abs.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [s.session]);

  const handleImport = useCallback(async (file: File) => {
    const text = await file.text();
    try {
      const { parseYaml, expandFragments } = await import('./yaml-parser');
      const docs = parseYaml(text);
      if (docs.length > 0) {
        const expanded = expandFragments(docs[0]);
        s.setSession({
          ...expanded,
          behaviors: expanded.behaviors.map((b: any) => ({ ...b, id: newId() })),
        });
      }
    } catch (err) {
      alert('Invalid ABS file: ' + (err as Error).message);
    }
  }, [s.setSession]);

  const handleNew = () => {
    s.setSession({
      session: 'New Session',
      description: '',
      abs_version: '0.1',
      behaviors: [],
      evaluations: [],
    });
  };

  const addFromPalette = useCallback(
    (actor: string, action: string) => {
      const afterId = s.session.behaviors[s.session.behaviors.length - 1]?.id;
      s.addBehavior(afterId, { actor, action });
    },
    [s.addBehavior, s.session.behaviors],
  );

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar
        behaviors={s.session.behaviors}
        selectedId={s.selectedId}
        onSelect={(id) => {
          s.select(id);
          setTab(0);
        }}
      />

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar
          onNew={handleNew}
          onExport={handleExport}
          onImport={handleImport}
        />

        <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
          <Box sx={{ maxWidth: 700, mx: 'auto' }}>
            {/* Session header */}
            <Box sx={{ mb: 2 }}>
              <TextField
                variant="standard"
                fullWidth
                value={s.session.session}
                onChange={(e) => s.updateSessionMeta({ session: e.target.value })}
                placeholder="Session name"
                slotProps={{
                  input: {
                    disableUnderline: true,
                    sx: { fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em' },
                  },
                }}
              />
              <TextField
                variant="standard"
                fullWidth
                value={s.session.description || ''}
                onChange={(e) => s.updateSessionMeta({ description: e.target.value })}
                placeholder="Describe what this session validates, models or simulates…"
                multiline
                maxRows={3}
                slotProps={{
                  input: {
                    disableUnderline: true,
                    sx: { fontSize: '0.8125rem', color: 'text.secondary' },
                  },
                }}
              />
            </Box>

            {/* Add behavior bar */}
            <Box sx={{ mb: 2 }}>
              <AddBehaviorBar onAdd={addFromPalette} />
            </Box>

            {/* Stats mini */}
            <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
              <Chip label={`${s.session.behaviors.length} steps`} size="small" color="primary" variant="outlined" />
              <Chip label={`${totalEvals} rules`} size="small" variant="outlined" sx={{ color: 'text.secondary' }} />
              <Chip
                label={s.session.behaviors.length > 0 ? 'Ready' : 'Empty'}
                size="small"
                color={s.session.behaviors.length > 0 ? 'success' : 'default'}
                variant="outlined"
              />
            </Box>

            {/* Flow */}
            <BehaviorFlow
              behaviors={s.session.behaviors}
              selectedId={s.selectedId}
              onSelect={(id) => {
                s.select(id);
                setTab(0);
              }}
              onRemove={s.removeBehavior}
              onAdd={s.addBehavior}
            />
          </Box>
        </Box>
      </Box>

      {/* Inspector */}
      <Paper
        square
        elevation={0}
        sx={{
          width: 400,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          borderLeft: '1px solid',
          borderColor: 'divider',
          overflow: 'hidden',
        }}
      >
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 48 }}
        >
          <Tab icon={<SettingsIcon fontSize="small" />} iconPosition="start" label="Properties" />
          <Tab icon={<CodeIcon fontSize="small" />} iconPosition="start" label="YAML" />
        </Tabs>

        <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
          {tab === 1 ? (
            <YAMLPreview session={s.session} />
          ) : s.selected ? (
            <BehaviorForm
              key={s.selected.id}
              behavior={s.selected}
              stepNumber={selectedIndex ?? undefined}
              onUpdate={(u) => s.updateBehavior(s.selected!.id, u)}
              onAddEval={(ev) => s.addEvaluation(s.selected!.id, ev)}
              onRemoveEval={(idx) => s.removeEvaluation(s.selected!.id, idx)}
            />
          ) : (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                textAlign: 'center',
                color: 'text.secondary',
              }}
            >
              <SettingsIcon sx={{ fontSize: 40, mb: 2, opacity: 0.3 }} />
              <Typography sx={{ fontWeight: 600 }}>No step selected</Typography>
              <Typography variant="body2" sx={{ mt: 0.5, maxWidth: 200 }}>
                Click a behavior in the flow to edit its properties.
              </Typography>
            </Box>
          )}
        </Box>
      </Paper>
    </Box>
  );
}


