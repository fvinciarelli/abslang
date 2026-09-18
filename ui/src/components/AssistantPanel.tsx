import { useState, useRef, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import SendIcon from '@mui/icons-material/Send';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';

import { buildSystemPrompt } from '../assistant-knowledge';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  onYamlGenerated?: (yaml: string) => void;
  isVSCode?: boolean;
}

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const MAX_TOKENS = 2000;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function AssistantPanel({ onYamlGenerated }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(true);
  const [tokenCount, setTokenCount] = useState(0);
  const [demoExceeded, setDemoExceeded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || demoExceeded) return;

    // Check token limit before sending
    const newTokens = tokenCount + estimateTokens(text);
    if (newTokens > MAX_TOKENS) {
      setMessages((m) => [...m,
        { role: 'user' as const, content: text },
        { role: 'assistant' as const, content: '✨ Thanks for trying the ABS Assistant! This is a demo limited to ~2,000 tokens per session. Start a new session or use `abslang chat` in the terminal with your own API key for unlimited conversations.' },
      ]);
      setDemoExceeded(true);
      setInput('');
      return;
    }

    const userMsg: Message = { role: 'user', content: text };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const resp = await fetch(DEEPSEEK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: buildSystemPrompt(text) },
            ...messages.map((m) => ({ role: m.role, content: m.content })),
            { role: 'user', content: text },
          ],
          temperature: 0.3,
          max_tokens: 4096,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`DeepSeek: ${resp.status} — ${errText.substring(0, 200)}`);
      }

      const data = await resp.json() as any;
      const content = data.choices?.[0]?.message?.content ?? '';
      const asstMsg: Message = { role: 'assistant', content };
      setMessages((m) => [...m, asstMsg]);
      setTokenCount((c) => c + estimateTokens(text) + estimateTokens(content));

      // Extract YAML if present
      const yaml = extractYaml(content);
      if (yaml && onYamlGenerated) {
        onYamlGenerated(yaml);
      }
    } catch (err: any) {
      setMessages((m) => [...m, { role: 'assistant', content: `Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, apiKey, onYamlGenerated, tokenCount, demoExceeded]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  if (showKeyInput) {
    return (
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          DeepSeek API Key
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Get one at platform.deepseek.com/api_keys — stored only in this session.
        </Typography>
        <TextField
          size="small"
          type="password"
          placeholder="sk-..."
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && apiKey && setShowKeyInput(false)}
        />
        <Chip
          label="Start chatting"
          color="primary"
          disabled={!apiKey}
          onClick={() => setShowKeyInput(false)}
          sx={{ alignSelf: 'flex-start' }}
        />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <Box
        sx={{
          px: 2,
          py: 1,
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <AutoAwesomeIcon fontSize="small" color="primary" />
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          ABS Assistant
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Chip
          label={`${tokenCount} / ${MAX_TOKENS} tokens`}
          size="small"
          variant="outlined"
          color={tokenCount > MAX_TOKENS * 0.8 ? 'warning' : 'default'}
          sx={{ fontSize: '0.7rem' }}
        />
        <Chip
          label="Key"
          size="small"
          variant="outlined"
          onClick={() => { setShowKeyInput(true); setMessages([]); setTokenCount(0); setDemoExceeded(false); }}
        />
      </Box>

      {/* Messages */}
      <Box sx={{ flex: 1, overflow: 'auto', px: 2, py: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {messages.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 4 }}>
            Describe the agent behavior you want to test.
            <br />
            I&apos;ll ask you questions and generate the .abs.yaml.
          </Typography>
        )}
        {messages.map((m, i) => (
          <Box
            key={i}
            sx={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
            }}
          >
            <Paper
              variant="outlined"
              sx={{
                px: 1.5,
                py: 1,
                bgcolor: m.role === 'user' ? 'primary.50' : 'grey.50',
                borderColor: m.role === 'user' ? 'primary.200' : 'divider',
              }}
            >
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {m.content.length > 2000 ? m.content.substring(0, 2000) + '\n\n... (truncated)' : m.content}
              </Typography>
            </Paper>
          </Box>
        ))}
        {loading && (
          <Box sx={{ alignSelf: 'flex-start' }}>
            <CircularProgress size={20} />
          </Box>
        )}
        <div ref={bottomRef} />
      </Box>

      {/* Input */}
      {demoExceeded ? (
        <Box sx={{ px: 2, py: 2, borderTop: 1, borderColor: 'divider', textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            ✨ Demo limit reached. Start a new session or use{' '}
            <code style={{ background: '#f0f0f0', padding: '1px 4px', borderRadius: 3 }}>abslang chat</code> with your own API key.
          </Typography>
        </Box>
      ) : (
      <Box sx={{ px: 2, py: 1.5, borderTop: 1, borderColor: 'divider', display: 'flex', gap: 1 }}>
        <TextField
          fullWidth
          size="small"
          multiline
          maxRows={4}
          placeholder="e.g. I need to test a refund flow with two API calls..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
        />
        <IconButton color="primary" onClick={send} disabled={loading || !input.trim()} size="small">
          <SendIcon fontSize="small" />
        </IconButton>
      </Box>
      )}
    </Box>
  );
}

// ── Inline helpers (no Node deps in browser) ──

function extractYaml(text: string): string | null {
  const match = text.match(/```yaml\n([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}

