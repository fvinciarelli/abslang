import { useState, useCallback, useEffect } from 'react';
import * as yaml from 'js-yaml';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Chip from '@mui/material/Chip';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import SettingsIcon from '@mui/icons-material/Settings';
import CodeIcon from '@mui/icons-material/Code';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import TuneIcon from '@mui/icons-material/Tune';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import { Topbar } from './components/Topbar';
import { SequenceView } from './components/SequenceView';
import { GraphView } from './components/GraphView';
import { BehaviorForm } from './components/BehaviorForm';
import { SessionPanel } from './components/SessionPanel';
import { YAMLPreview } from './components/YAMLPreview';
import { RunPanel } from './components/RunPanel';
import { AssistantPanel } from './components/AssistantPanel';
import { useSession } from './hooks/useSession';
import { behaviorToYAML, newId } from './types';

const IS_VSCODE = !!(window as any).__ABS_VSCODE__;

declare global {
  interface Window {
    __ABS_VSCODE__?: boolean;
  }
}

export default function App() {
  const s = useSession();
  const [tab, setTab] = useState(0);
  const [mode, setMode] = useState<'sequence' | 'graph'>('sequence');
  const [showTool, setShowTool] = useState(false);

  const selectedIndex = s.selectedId
    ? s.session.behaviors.findIndex((b) => b.id === s.selectedId) + 1
    : null;

  const totalEvals = s.session.behaviors.reduce((c, b) => c + (b.evaluations?.length ?? 0), 0);

  const handleExport = useCallback(() => {
    const doc: any = { session: s.session.session };
    if (s.session.description) doc.description = s.session.description;
    if (s.session.abs_version) doc.abs_version = s.session.abs_version;
    if (s.session.dataset) doc.dataset = s.session.dataset;
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
          behaviors: expanded.behaviors.map((b: any) => ({ ...b, id: b.id || newId() })),
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
      abs_version: '0.2',
      behaviors: [],
      evaluations: [],
    });
  };

  const handleAdd = useCallback(
    (actor: string, action: string) => {
      const afterId = s.session.behaviors[s.session.behaviors.length - 1]?.id;
      s.addBehavior(afterId, { actor, action });
    },
    [s.addBehavior, s.session.behaviors],
  );

  // VSCode bridge: receive documents
  useEffect(() => {
    if (!IS_VSCODE) return;
    const handler = async (e: Event) => {
      const { yaml: yamlText } = (e as CustomEvent).detail;
      try {
        const { parseYaml, expandFragments } = await import('./yaml-parser');
        const docs = parseYaml(yamlText);
        if (docs.length > 0) {
          const expanded = expandFragments(docs[0]);
          s.setSession({
            ...expanded,
            behaviors: expanded.behaviors.map((b: any) => ({ ...b, id: b.id || newId() })),
          });
        }
      } catch (err) {
        console.error('Failed to parse ABS document:', err);
      }
    };
    window.addEventListener('abs-load-document', handler);
    return () => window.removeEventListener('abs-load-document', handler);
  }, [s.setSession]);

  // VSCode bridge: auto-save
  useEffect(() => {
    if (!IS_VSCODE) return;
    const doc: any = { session: s.session.session };
    if (s.session.description) doc.description = s.session.description;
    if (s.session.abs_version) doc.abs_version = s.session.abs_version;
    if (s.session.dataset) doc.dataset = s.session.dataset;
    doc.behaviors = s.session.behaviors.map(behaviorToYAML);
    if (s.session.evaluations?.length) doc.evaluations = s.session.evaluations;
    const yamlStr = yaml.dump(doc, { indent: 2, lineWidth: -1, noRefs: true });
    const timer = setTimeout(() => {
      window.dispatchEvent(new CustomEvent('abs-save', { detail: { yaml: yamlStr } }));
    }, 300);
    return () => clearTimeout(timer);
  }, [s.session]);

  const handleYamlFromAssistant = useCallback(async (yamlText: string) => {
    try {
      const { parseYaml, expandFragments } = await import('./yaml-parser');
      const docs = parseYaml(yamlText);
      if (docs.length > 0) {
        const expanded = expandFragments(docs[0]);
        s.setSession({
          ...expanded,
          behaviors: expanded.behaviors.map((b: any) => ({ ...b, id: b.id || newId() })),
        });
        setTab(1);
      }
    } catch (err) {
      console.error('Failed to parse generated YAML:', err);
    }
  }, [s.setSession]);

  const onSelect = useCallback((id: string) => {
    s.select(id);
    setTab(1);
  }, [s.select]);

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar onNew={handleNew} onExport={handleExport} onImport={handleImport} isVSCode={IS_VSCODE} />

        {/* Header: session meta + mode toggle */}
        <Box sx={{ px: 3, pt: 1.5, pb: 1, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Box sx={{ flex: 1, minWidth: 240 }}>
            <TextField
              variant="standard"
              fullWidth
              value={s.session.session}
              onChange={(e) => s.updateSessionMeta({ session: e.target.value })}
              placeholder="Session name"
              slotProps={{ input: { disableUnderline: true, sx: { fontSize: '1.15rem', fontWeight: 700, letterSpacing: '-0.01em' } } }}
            />
            <TextField
              variant="standard"
              fullWidth
              value={s.session.description || ''}
              onChange={(e) => s.updateSessionMeta({ description: e.target.value })}
              placeholder="Describe what this session validates…"
              slotProps={{ input: { disableUnderline: true, sx: { fontSize: '0.75rem', color: 'text.secondary' } } }}
            />
          </Box>

          <Chip label={`${s.session.behaviors.length} steps`} size="small" variant="outlined" />
          <Chip label={`${totalEvals} rules`} size="small" variant="outlined" />

          <ToggleButtonGroup
            value={mode}
            exclusive
            size="small"
            onChange={(_, v) => v && setMode(v)}
            sx={{ '& .MuiToggleButton-root': { textTransform: 'none', gap: 0.5 } }}
          >
            <ToggleButton value="sequence">
              <SwapVertIcon fontSize="small" />
              Sequence
            </ToggleButton>
            <ToggleButton value="graph">
              <AccountTreeIcon fontSize="small" />
              Graph
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {/* Canvas */}
        <Box sx={{ flex: 1, overflow: 'hidden', position: 'relative', bgcolor: 'background.default' }}>
          {mode === 'sequence' ? (
            <SequenceView
              behaviors={s.session.behaviors}
              selectedId={s.selectedId}
              showTool={showTool}
              onToggleTool={() => setShowTool((v) => !v)}
              onSelect={onSelect}
              onAdd={handleAdd}
            />
          ) : (
            <GraphView
              behaviors={s.session.behaviors}
              selectedId={s.selectedId}
              onSelect={onSelect}
            />
          )}
        </Box>

        {!IS_VSCODE && <RunPanel session={s.session} />}
      </Box>

      {/* Inspector: Properties / YAML / Assistant */}
      <Paper square elevation={0} sx={{ width: 400, flexShrink: 0, display: 'flex', flexDirection: 'column', borderLeft: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 48 }}>
          <Tab icon={<TuneIcon fontSize="small" />} iconPosition="start" label="Session" />
          <Tab icon={<SettingsIcon fontSize="small" />} iconPosition="start" label="Step" />
          <Tab icon={<CodeIcon fontSize="small" />} iconPosition="start" label="YAML" />
          <Tab icon={<AutoAwesomeIcon fontSize="small" />} iconPosition="start" label="Assistant" />
        </Tabs>

        <Box sx={{ flex: 1, overflow: 'auto', p: tab === 3 ? 0 : 3 }}>
          {tab === 3 ? (
            <AssistantPanel onYamlGenerated={handleYamlFromAssistant} isVSCode={IS_VSCODE} />
          ) : tab === 2 ? (
            <YAMLPreview session={s.session} />
          ) : tab === 0 ? (
            <SessionPanel session={s.session} onUpdate={s.updateSessionMeta} />
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
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center', color: 'text.secondary' }}>
              <SettingsIcon sx={{ fontSize: 40, mb: 2, opacity: 0.3 }} />
              <Typography sx={{ fontWeight: 600 }}>No step selected</Typography>
              <Typography variant="body2" sx={{ mt: 0.5, maxWidth: 200 }}>
                Click a step in the canvas to edit its properties, evaluations, and example text.
              </Typography>
            </Box>
          )}
        </Box>
      </Paper>
    </Box>
  );
}
