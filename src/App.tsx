import './index.css';
import { useState, useEffect, useMemo, useRef } from 'react';
import { PipecatClient, RTVIEvent } from '@pipecat-ai/client-js';
import {
  PipecatClientProvider,
  PipecatClientAudio,
  usePipecatClient,
  usePipecatClientTransportState,
} from '@pipecat-ai/client-react';
import { DailyTransport } from '@pipecat-ai/daily-transport';

import type {
  Transcript,
  ToolCall,
  TranscriptEvent,
  FunctionCallInProgressEvent,
  FunctionCallDeprecatedEvent,
  FunctionCallStoppedEvent,
} from './types';
import {
  normalizeToolName,
  normalizeToolArgs,
  upsertToolCall,
  getStringArgument,
  resolveStartUrl,
} from './utils';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATE_COLORS: Record<string, string> = {
  ready:         '#22c55e',
  connected:     '#22c55e',
  connecting:    '#f59e0b',
  disconnecting: '#f59e0b',
  disconnected:  '#6b7280',
  error:         '#ef4444',
};

const STATUS_BORDER: Record<string, string> = {
  completed: '#22c55e',
  cancelled: '#ef4444',
  running:   '#f59e0b',
};

// Only show_image is registered on the backend — never use generate_image
const DEFAULT_PROMPT =
  "You are a helpful visual assistant. You have exactly TWO tools:\n\n" +
  "1. show_text({ text: string }) — displays a text card on screen\n" +
  "2. show_image({ url: string }) — displays an image on screen\n\n" +
  "IMPORTANT RULES:\n" +
  "- For show_image, always use this URL format: https://source.unsplash.com/600x400/?KEYWORD\n" +
  "  Replace KEYWORD with what the user asked for. Example: for 'a dog' use\n" +
  "  https://source.unsplash.com/600x400/?dog\n" +
  "- Always use a tool when the user asks to see something.\n" +
  "- Keep spoken replies short, under 2 sentences.";

// NOTE: Singleton is intentional for this single-page playground.
// In a multi-page app, move this into a context provider with useRef.
const pipecatClient = new PipecatClient({
  transport: new DailyTransport(),
  enableMic: true,
  enableCam: false,
});

// ─── ConnectionBadge ──────────────────────────────────────────────────────────

function ConnectionBadge({ state }: { state: string }) {
  const color = STATE_COLORS[state] ?? '#6b7280';
  const isAnimating = state === 'connecting' || state === 'disconnecting';
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
      padding: '0.3rem 0.8rem', borderRadius: '999px',
      background: '#1e293b', border: '1px solid #334155',
      fontSize: '0.78rem', fontFamily: "'JetBrains Mono', monospace",
      letterSpacing: '0.03em', color: '#94a3b8', userSelect: 'none',
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: color, boxShadow: `0 0 6px ${color}`,
        animation: isAnimating ? 'pulse-dot 1s ease-in-out infinite' : 'none',
      }} />
      {state}
    </div>
  );
}

// ─── SectionCard ──────────────────────────────────────────────────────────────

function SectionCard({
  title, children, style,
}: {
  title: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{
      background: '#161b27', border: '1px solid #1e293b', borderRadius: 12,
      padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column',
      gap: '0.75rem', ...style,
    }}>
      <h3 style={{
        margin: 0, fontSize: '0.72rem', fontWeight: 600,
        letterSpacing: '0.1em', textTransform: 'uppercase', color: '#475569',
      }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

// ─── ShowImage ────────────────────────────────────────────────────────────────
// Handles show_image with a visible loading spinner and error fallback

function ShowImage({ url }: { url: string }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');

  // Reset status whenever the URL changes (new tool call)
  useEffect(() => { setStatus('loading'); }, [url]);

  return (
    <div style={{ width: '100%', textAlign: 'center' }}>
      {/* Always in the DOM — visibility controlled by status */}
      <img
        src={url}
        alt="Tool output"
        style={{
          display: status === 'loaded' ? 'block' : 'none',
          maxWidth: '100%', maxHeight: 220, borderRadius: 10,
          objectFit: 'cover', boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          margin: '0 auto',
        }}
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('error')}
      />

      {/* Loading spinner */}
      {status === 'loading' && (
        <div style={{ padding: '1.5rem', color: '#475569' }}>
          <span style={{
            display: 'inline-block', width: 24, height: 24,
            border: '2px solid #1e293b', borderTopColor: '#3b82f6',
            borderRadius: '50%', animation: 'spin-ring 0.75s linear infinite',
          }} />
          <p style={{
            marginTop: '0.75rem', fontSize: '0.78rem',
            fontFamily: "'JetBrains Mono', monospace", color: '#475569',
          }}>
            Loading image…
          </p>
        </div>
      )}

      {/* Error state */}
      {status === 'error' && (
        <div style={{
          padding: '1rem', background: '#2d0f0f', borderRadius: 8,
          border: '1px solid #7f1d1d', color: '#fca5a5',
          fontSize: '0.8rem', fontFamily: "'JetBrains Mono', monospace",
        }}>
          ❌ Failed to load image
          <br />
          <span style={{ color: '#475569', fontSize: '0.72rem' }}>
            URL: {url}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── ToolOutput ───────────────────────────────────────────────────────────────

function ToolOutput({ toolCalls }: { toolCalls: ToolCall[] }) {
  if (toolCalls.length === 0) {
    return (
      <div style={{ textAlign: 'center', color: '#334155' }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚙️</div>
        <p style={{ fontSize: '0.85rem', fontFamily: "'JetBrains Mono', monospace" }}>
          Awaiting tool calls…
        </p>
      </div>
    );
  }

  const latest = toolCalls[toolCalls.length - 1];

  // show_image — bot provides a direct URL, render with loading state
  const imageUrl = getStringArgument(latest.args, ['url', 'image_url', 'imageUrl', 'src']);
  if (latest.name === 'show_image' && imageUrl) {
    return <ShowImage url={imageUrl} />;
  }

  // show_text — bot provides a text string, render as a styled card
  const displayText = getStringArgument(latest.args, ['text', 'message', 'content', 'title']);
  if (latest.name === 'show_text' && displayText) {
    return (
      <div style={{
        padding: '1rem 1.25rem', width: '100%',
        background: 'linear-gradient(135deg, #1e3a5f 0%, #1e293b 100%)',
        border: '1px solid #3b82f6', borderRadius: 10, color: '#93c5fd',
        fontWeight: 500, fontSize: '1rem', lineHeight: 1.5,
        boxShadow: '0 0 20px rgba(59,130,246,0.1)',
      }}>
        {displayText}
      </div>
    );
  }

  // Generic fallback for any other tool
  return (
    <div style={{
      padding: '0.75rem 1rem', background: '#1e293b', borderRadius: 8,
      fontFamily: "'JetBrains Mono', monospace", fontSize: '0.78rem',
      color: '#94a3b8', width: '100%',
    }}>
      <span style={{ color: '#f59e0b' }}>{latest.name}</span>
      {' '}called with{' '}
      <span style={{ color: '#7dd3fc' }}>{JSON.stringify(latest.args)}</span>
    </div>
  );
}

// ─── PromptPlayground ─────────────────────────────────────────────────────────

function PromptPlayground() {
  const client           = usePipecatClient();
  const transportState   = usePipecatClientTransportState();
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const [prompt, setPrompt]             = useState(DEFAULT_PROMPT);
  const [error, setError]               = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [transcripts, setTranscripts]   = useState<Transcript[]>([]);
  const [toolCalls, setToolCalls]       = useState<ToolCall[]>([]);

  // Auto-scroll transcript to bottom on new entries
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  // ── Event listeners ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!client) return;

    const onBotTranscript = (data: TranscriptEvent) =>
      setTranscripts((prev) => [...prev, { speaker: 'bot', text: data.text }]);

    const onUserTranscript = (data: TranscriptEvent) => {
      // Skip intermediate partial transcripts — only keep final ones
      if (data.final === false) return;
      setTranscripts((prev) => {
        const last = prev[prev.length - 1];
        // If the new text starts with the last user entry it's a continuation — replace it
        if (last?.speaker === 'user' && data.text.startsWith(last.text)) {
          return [...prev.slice(0, -1), { speaker: 'user', text: data.text }];
        }
        return [...prev, { speaker: 'user', text: data.text }];
      });
    };

    const onFunctionCallInProgress = (data: FunctionCallInProgressEvent) =>
      setToolCalls((prev) => upsertToolCall(prev, {
        id:        data.tool_call_id,
        name:      normalizeToolName(data.function_name),
        args:      normalizeToolArgs(data.arguments),
        timestamp: new Date().toLocaleTimeString(),
        status:    'running',
      }));

    const onFunctionCallDeprecated = (data: FunctionCallDeprecatedEvent) =>
      setToolCalls((prev) => upsertToolCall(prev, {
        id:        data.tool_call_id,
        name:      normalizeToolName(data.function_name),
        args:      normalizeToolArgs(data.args),
        timestamp: new Date().toLocaleTimeString(),
        status:    'running',
      }));

    const onFunctionCallStopped = (data: FunctionCallStoppedEvent) =>
      setToolCalls((prev) => upsertToolCall(prev, {
        id:        data.tool_call_id,
        name:      normalizeToolName(data.function_name),
        args:      prev.find((c) => c.id === data.tool_call_id)?.args ?? {},
        timestamp: prev.find((c) => c.id === data.tool_call_id)?.timestamp ?? new Date().toLocaleTimeString(),
        status:    data.cancelled ? 'cancelled' : 'completed',
        result:    data.result,
      }));

    client.on(RTVIEvent.BotTranscript,             onBotTranscript);
    client.on(RTVIEvent.UserTranscript,            onUserTranscript);
    client.on(RTVIEvent.LLMFunctionCallInProgress, onFunctionCallInProgress);
    client.on(RTVIEvent.LLMFunctionCall,           onFunctionCallDeprecated);
    client.on(RTVIEvent.LLMFunctionCallStopped,    onFunctionCallStopped);

    return () => {
      client.off(RTVIEvent.BotTranscript,             onBotTranscript);
      client.off(RTVIEvent.UserTranscript,            onUserTranscript);
      client.off(RTVIEvent.LLMFunctionCallInProgress, onFunctionCallInProgress);
      client.off(RTVIEvent.LLMFunctionCall,           onFunctionCallDeprecated);
      client.off(RTVIEvent.LLMFunctionCallStopped,    onFunctionCallStopped);
      client.disconnect(); // Prevent orphaned WebRTC sessions on unmount
    };
  }, [client]);

  // ── Session control ───────────────────────────────────────────────────────────
  const startSession = async () => {
    if (!client || isConnecting) return;
    setIsConnecting(true);
    setError(null);
    setTranscripts([]);
    setToolCalls([]);

    try {
      const startUrl = resolveStartUrl(import.meta.env.VITE_PIPECAT_URL);
      const response = await fetch(startUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          createDailyRoom: true,
          transport: 'daily',
          body: { bot_type: 'activity', prompt },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Server error (${response.status} ${response.statusText})${text ? `: ${text}` : ''}`);
      }

      const data = await response.json();
      await client.connect({ url: data.dailyRoom, token: data.dailyToken });
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(
        message === 'Failed to fetch'
          ? `Could not reach ${resolveStartUrl(import.meta.env.VITE_PIPECAT_URL)}. Is the backend running?`
          : message
      );
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = () => client?.disconnect();

  // ── Derived state ─────────────────────────────────────────────────────────────
  const toolCounts = useMemo(
    () => toolCalls.reduce<Record<string, number>>((acc, c) => {
      acc[c.name] = (acc[c.name] || 0) + 1;
      return acc;
    }, {}),
    [toolCalls]
  );

  const isSessionActive = !['disconnected', 'error'].includes(transportState);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem',
      padding: '1.5rem', height: '100vh', maxWidth: 1400, margin: '0 auto',
    }}>

      {/* ── LEFT COLUMN ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', minHeight: 0 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: '1.35rem', fontWeight: 600, color: '#f1f5f9', letterSpacing: '-0.02em' }}>
              Prompt Playground
            </h1>
            <p style={{ fontSize: '0.78rem', color: '#475569', marginTop: 2 }}>
              Pipecat Voice AI · Real-time Testing
            </p>
          </div>
          <ConnectionBadge state={transportState} />
        </div>

        {/* System prompt */}
        <SectionCard title="System Prompt">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isSessionActive}
            style={{
              width: '100%', height: 110, padding: '0.65rem 0.75rem',
              background: '#0d1117', border: '1px solid #1e293b', borderRadius: 8,
              color: '#e2e8f0', fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.8rem', lineHeight: 1.6, resize: 'vertical',
            }}
          />
        </SectionCard>

        {/* Controls */}
        <SectionCard title="Controls">
          {error && (
            <div style={{
              padding: '0.6rem 0.85rem', background: '#2d0f0f',
              border: '1px solid #7f1d1d', borderRadius: 7,
              color: '#fca5a5', fontSize: '0.8rem', lineHeight: 1.5,
            }}>
              ⚠️ {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.65rem' }}>
            {!isSessionActive ? (
              <button
                onClick={startSession}
                disabled={isConnecting}
                style={{
                  padding: '0.6rem 1.4rem', borderRadius: 8, border: 'none',
                  cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem',
                  background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                  color: 'white', display: 'flex', alignItems: 'center', gap: '0.5rem',
                  boxShadow: '0 2px 12px rgba(37,99,235,0.35)',
                }}
              >
                {isConnecting ? (
                  <>
                    <span style={{
                      display: 'inline-block', width: 12, height: 12,
                      border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white',
                      borderRadius: '50%', animation: 'spin-ring 0.75s linear infinite',
                    }} />
                    Connecting…
                  </>
                ) : '▶  Start Session'}
              </button>
            ) : (
              <button
                onClick={disconnect}
                disabled={transportState === 'disconnecting'}
                style={{
                  padding: '0.6rem 1.4rem', borderRadius: 8, cursor: 'pointer',
                  fontWeight: 600, fontSize: '0.875rem',
                  background: '#1e293b', color: '#f87171',
                  border: '1px solid #7f1d1d',
                }}
              >
                ■  Disconnect
              </button>
            )}
          </div>
        </SectionCard>

        {/* Transcript */}
        <SectionCard
          title={`Transcript${transcripts.length ? ` · ${transcripts.length} lines` : ''}`}
          style={{ flex: 1, minHeight: 0 }}
        >
          <div style={{
            flex: 1, overflowY: 'auto', display: 'flex',
            flexDirection: 'column', gap: '0.4rem', paddingRight: '0.25rem',
          }}>
            {transcripts.length === 0 ? (
              <p style={{ color: '#334155', fontSize: '0.82rem', fontFamily: "'JetBrains Mono', monospace", marginTop: '0.5rem' }}>
                Start a session and speak to see the transcript…
              </p>
            ) : (
              transcripts.map((t, i) => (
                <div key={i} className="transcript-line" style={{
                  display: 'flex', gap: '0.6rem', alignItems: 'flex-start',
                  padding: '0.5rem 0.65rem', borderRadius: 7,
                  background: t.speaker === 'user' ? '#0f172a' : '#131c2b',
                  border: `1px solid ${t.speaker === 'user' ? '#1e3a5f' : '#1a2e1a'}`,
                }}>
                  <span style={{
                    fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em',
                    textTransform: 'uppercase', paddingTop: 2, flexShrink: 0, minWidth: 28,
                    color: t.speaker === 'user' ? '#60a5fa' : '#4ade80',
                    fontFamily: "'JetBrains Mono', monospace",
                  }}>
                    {t.speaker === 'user' ? 'YOU' : 'BOT'}
                  </span>
                  <span style={{ fontSize: '0.875rem', color: '#cbd5e1', lineHeight: 1.55 }}>
                    {t.text}
                  </span>
                </div>
              ))
            )}
            <div ref={transcriptEndRef} />
          </div>
        </SectionCard>
      </div>

      {/* ── RIGHT COLUMN ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', minHeight: 0 }}>

        {/* Active tool output */}
        <SectionCard title="Active Tool Output" style={{ minHeight: 200 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.5rem' }}>
            <ToolOutput toolCalls={toolCalls} />
          </div>
        </SectionCard>

        {/* Tool call log */}
        <SectionCard
          title={`Tool Call Log${toolCalls.length ? ` · ${toolCalls.length} calls` : ''}`}
          style={{ flex: 1, minHeight: 0 }}
        >
          {/* Per-tool count pills */}
          {Object.keys(toolCounts).length > 0 && (
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {Object.entries(toolCounts).map(([name, count]) => (
                <span key={name} style={{
                  background: '#1e293b', border: '1px solid #334155',
                  padding: '0.15rem 0.6rem', borderRadius: '999px',
                  fontSize: '0.75rem', fontFamily: "'JetBrains Mono', monospace", color: '#94a3b8',
                }}>
                  {name} <strong style={{ color: '#e2e8f0' }}>{count}</strong>
                </span>
              ))}
            </div>
          )}

          {/* Log list */}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingRight: '0.25rem' }}>
            {toolCalls.length === 0 ? (
              <p style={{ color: '#334155', fontSize: '0.82rem', fontFamily: "'JetBrains Mono', monospace" }}>
                No tool calls recorded yet…
              </p>
            ) : (
              toolCalls.slice().reverse().map((call) => (
                <div key={call.id} className="tool-item" style={{
                  padding: '0.7rem 0.85rem', borderRadius: 9, flexShrink: 0,
                  background: '#0d1117', border: '1px solid #1e293b',
                  borderLeft: `3px solid ${STATUS_BORDER[call.status] ?? '#6b7280'}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                    <strong style={{ color: '#e2e8f0', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.82rem' }}>
                      {call.name}
                    </strong>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <span style={{
                        fontSize: '0.68rem', padding: '0.1rem 0.5rem', borderRadius: '999px',
                        background: '#1e293b', fontFamily: "'JetBrains Mono', monospace",
                        color: STATUS_BORDER[call.status],
                        border: `1px solid ${STATUS_BORDER[call.status]}33`,
                      }}>
                        {call.status}
                      </span>
                      <small style={{ color: '#475569', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.7rem' }}>
                        {call.timestamp}
                      </small>
                    </div>
                  </div>
                  <pre style={{
                    fontSize: '0.72rem', background: '#161b27', padding: '0.5rem 0.65rem',
                    borderRadius: 6, margin: 0, overflowX: 'auto', color: '#7dd3fc',
                    fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.5, border: '1px solid #1e293b',
                  }}>
                    {JSON.stringify(call.args, null, 2)}
                  </pre>
                </div>
              ))
            )}
          </div>
        </SectionCard>
      </div>

      {/* Hidden audio element — required by Pipecat */}
      <PipecatClientAudio />
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <PipecatClientProvider client={pipecatClient}>
      <PromptPlayground />
    </PipecatClientProvider>
  );
}