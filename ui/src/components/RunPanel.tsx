import { useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Collapse from '@mui/material/Collapse';
import LinearProgress from '@mui/material/LinearProgress';
import Chip from '@mui/material/Chip';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SettingsIcon from '@mui/icons-material/Settings';
import type { ABSSession } from '../types';
import { behaviorToYAML } from '../types';
import * as yaml from 'js-yaml';

interface Props {
  session: ABSSession;
}

interface StepEval {
  step: number;
  behavior: string;
  matched: boolean;
  sent?: boolean;
  evaluations: { type: string; passed: boolean; reason: string; score: number }[];
}

interface RunData {
  passed: boolean;
  steps: StepEval[];
  chainEvaluations: { type: string; passed: boolean; reason: string }[];
}

export function RunPanel({ session }: Props) {
  const [agentUrl, setAgentUrl] = useState('http://localhost:8080/chat');
  const [showConfig, setShowConfig] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);

    try {
      const doc: any = { session: session.session };
      if (session.description) doc.description = session.description;
      doc.behaviors = session.behaviors.map(behaviorToYAML);
      if (session.evaluations?.length) doc.evaluations = session.evaluations;
      const yamlStr = yaml.dump(doc, { indent: 2, lineWidth: -1, noRefs: true });

      // Load the runner dynamically
      const runner = await import('./abs-runner');
      const data = await runner.runBrowser(yamlStr, { url: agentUrl, format: 'openai' });

      setResult({
        passed: data.passed,
        steps: data.steps.map((s: any) => ({
          step: s.step,
          behavior: `${s.behavior.actor} ${s.behavior.action}${s.behavior.target ? ' → ' + s.behavior.target : ''}`,
          matched: s.matched,
          sent: s.sent,
          evaluations: s.evaluations.map((e: any) => ({
            type: e.type,
            passed: e.passed,
            reason: e.reason,
            score: e.score,
          })),
        })),
        chainEvaluations: data.chainEvaluations.map((e: any) => ({
          type: e.type,
          passed: e.passed,
          reason: e.reason,
        })),
      });
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setRunning(false);
    }
  }, [session, agentUrl]);

  const totalSteps = result?.steps.length ?? 0;
  const matchedSteps = result?.steps.filter((s) => s.matched || s.sent).length ?? 0;
  const totalEvals =
    (result?.steps.reduce((c, s) => c + s.evaluations.length, 0) ?? 0) +
    (result?.chainEvaluations.length ?? 0);
  const passedEvals =
    (result?.steps.reduce((c, s) => c + s.evaluations.filter((e) => e.passed).length, 0) ?? 0) +
    (result?.chainEvaluations.filter((e) => e.passed).length ?? 0);

  return (
    <Box sx={{ borderTop: 1, borderColor: 'divider', bgcolor: 'grey.50' }}>
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2,
          py: 1,
          cursor: 'pointer',
        }}
        onClick={() => setShowConfig(!showConfig)}
      >
        <PlayArrowIcon fontSize="small" color="success" />
        <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>
          Run
        </Typography>
        <SettingsIcon fontSize="small" sx={{ opacity: 0.4 }} />
      </Box>

      <Collapse in={showConfig}>
        <Box sx={{ px: 2, pb: 2 }}>
          <TextField
            size="small"
            fullWidth
            label="Agent URL"
            value={agentUrl}
            onChange={(e) => setAgentUrl(e.target.value)}
            placeholder="http://localhost:8080/chat"
            sx={{ mb: 1 }}
          />
          <Button
            variant="contained"
            color="success"
            fullWidth
            startIcon={<PlayArrowIcon />}
            onClick={handleRun}
            disabled={running}
          >
            {running ? 'Running...' : 'Run Session'}
          </Button>
        </Box>
      </Collapse>

      {/* Progress */}
      {running && <LinearProgress sx={{ mx: 2, mb: 1 }} />}

      {/* Results */}
      {(result || error) && (
        <Box sx={{ px: 2, pb: 2, maxHeight: 300, overflow: 'auto' }}>
          {error && (
            <Typography variant="body2" color="error" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
              {error}
            </Typography>
          )}

          {result && (
            <>
              <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                <Chip
                  label={result.passed ? '✅ PASSED' : '❌ FAILED'}
                  size="small"
                  color={result.passed ? 'success' : 'error'}
                />
                <Chip label={`${matchedSteps}/${totalSteps} steps`} size="small" variant="outlined" />
                <Chip label={`${passedEvals}/${totalEvals} evals`} size="small" variant="outlined" />
              </Box>

              {result.steps.map((s) => (
                <Box key={s.step} sx={{ mb: 0.5 }}>
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: 'monospace',
                      fontSize: 11,
                      color: s.sent ? 'text.secondary' : s.matched ? 'success.main' : 'error.main',
                    }}
                  >
                    {s.sent ? '→' : s.matched ? '✅' : '❌'} Step {s.step}: {s.behavior}
                  </Typography>
                  {s.evaluations.map((e, i) => (
                    <Typography
                      key={i}
                      variant="body2"
                      sx={{
                        fontFamily: 'monospace',
                        fontSize: 10,
                        ml: 4,
                        color: e.passed ? 'success.main' : 'error.main',
                      }}
                    >
                      {e.passed ? '✅' : '❌'} {e.type}: {e.reason?.substring(0, 80)}
                    </Typography>
                  ))}
                </Box>
              ))}

              {result.chainEvaluations.length > 0 && (
                <Typography variant="body2" fontWeight={600} sx={{ mt: 1, mb: 0.5, fontSize: 11 }}>
                  Chain evaluations
                </Typography>
              )}
              {result.chainEvaluations.map((e, i) => (
                <Typography
                  key={i}
                  variant="body2"
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: 11,
                    color: e.passed ? 'success.main' : 'error.main',
                  }}
                >
                  {e.passed ? '✅' : '❌'} {e.type}: {e.reason?.substring(0, 80)}
                </Typography>
              ))}
            </>
          )}
        </Box>
      )}
    </Box>
  );
}
