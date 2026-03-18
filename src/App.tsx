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

// Sound effect emoji map for play_sound visual feedback
const SOUND_EMOJIS: Record<string, string> = {
  creaky_door:  '🚪',
  monkey_laugh: '🐒',
  big_splash:   '💦',
};

// Confetti colours per variant
const CONFETTI_COLORS = ['#f59e0b', '#3b82f6', '#22c55e', '#ef4444', '#a855f7', '#ec4899'];

// Official Zubi system prompt — backend already has all tool definitions registered.
// Template literal used per team leader review (no string concatenation).
const DEFAULT_PROMPT = `
You are Zubi, a bubbly, empathetic blue elephant. You are a peer/partner to a child.
Indian English Prosody: Speak with a syllable-timed rhythm (give every syllable equal length). Avoid vowel reduction (dont turn vowels into uh sounds).
Syntax: Use Indian English patterns: We are ready, no?, It is very-very big!, I am simply stuck!, I am here only. Default language is English for the whole conversation.
Language rule: When the user or system explicitly asks you to explain the current activity instructions in another language Hindi, Punjabi, Marathi, Gujarati, respond in that language only for that single message—no mixing with English (no Hinglish). Use pure language so the voice works well. After that one response, continue strictly in English. The rest of the activity and all other turns stay in English. Do not keep speaking in the other language after explaining the instructions.
Interaction Rules:
Turn-Taking: NEVER speak over the child. Wait for a clear pause.
Micro-Responses: Speak in 1-2 short, energetic sentences only. No monologues.
Character Integrity: You are a real elephant in a Magic Jungle. Never mention AI or code.
Tool Usage: ALWAYS call tools AFTER completing your spoken response. First speak your complete sentence or response, then make the tool call. Never interrupt your speech with tool calls.
Use the tools provided to show text, images, transition activities, and call activity_complete when the user has finished the current activity.
Activity completion: When the activity's success condition is met (task done), call activity_complete immediately in the same or next turn. Never wait for the child to say "done", "hi", "what happened", or anything else—you decide when the activity is complete and you call the tool.
When the user asks you to create, draw, or visualize something from a description, use generate_image(description=...) to generate an image with AI; the result may include a URL to show the image.
`;

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
// Renders an image URL with loading spinner and error fallback

function ShowImage({ url, label }: { url: string; label?: string }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');

  useEffect(() => { setStatus('loading'); }, [url]);

  return (
    <div style={{ width: '100%', textAlign: 'center' }}>
<img
  src={url}
  alt={label ?? 'Tool output'}
  style={{
    width: '100%',
    maxWidth: 400, // ✅ prevents overflow
    height: 'auto',
    borderRadius: 10,
    objectFit: 'cover',
    boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
    margin: '0 auto',
    display: status === 'loaded' ? 'block' : 'none',
  }}
  onLoad={() => setStatus('loaded')}
  onError={() => setStatus('error')}
/>
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
            {label ? `Generating "${label}"…` : 'Loading image…'}
          </p>
        </div>
      )}

      {status === 'error' && (
        <div style={{
          padding: '1rem', background: '#2d0f0f', borderRadius: 8,
          border: '1px solid #7f1d1d', color: '#fca5a5',
          fontSize: '0.8rem', fontFamily: "'JetBrains Mono', monospace",
        }}>
          ❌ Failed to load image
          <br />
          <span style={{ color: '#475569', fontSize: '0.72rem' }}>URL: {url}</span>
        </div>
      )}

      {status === 'loaded' && label && (
        <p style={{
          marginTop: '0.5rem', fontSize: '0.72rem', color: '#475569',
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          "{label}"
        </p>
      )}
    </div>
  );
}

// ─── ConfettiDisplay ──────────────────────────────────────────────────────────
// Visual confetti burst — variant 1 = small, 2 = medium, 3 = full screen

function ConfettiDisplay({ variant }: { variant: number }) {
  const count = variant === 1 ? 12 : variant === 2 ? 24 : 40;
  const size  = variant === 3 ? 'large' : 'normal';

  return (
    <div style={{
      width: '100%', padding: '1rem',
      background: 'linear-gradient(135deg, #1a0533 0%, #0d1117 100%)',
      borderRadius: 10, textAlign: 'center', position: 'relative', overflow: 'hidden',
      minHeight: 120,
    }}>
      {/* Confetti pieces */}
      <div style={{ position: 'relative', height: size === 'large' ? 100 : 70 }}>
        {Array.from({ length: count }).map((_, i) => (
          <span
            key={i}
            style={{
              position: 'absolute',
              left: `${(i / count) * 100}%`,
              top: `${Math.random() * 80}%`,
              width: size === 'large' ? 10 : 7,
              height: size === 'large' ? 10 : 7,
              borderRadius: i % 3 === 0 ? '50%' : 2,
              background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
              animation: `fade-in ${0.3 + (i * 0.05)}s ease forwards`,
              transform: `rotate(${i * 30}deg)`,
            }}
          />
        ))}
      </div>
      <p style={{
        fontSize: '1.5rem', margin: '0.5rem 0 0.25rem',
      }}>
        {variant === 3 ? '🎉🎊🎉' : variant === 2 ? '🎊🎉' : '🎉'}
      </p>
      <p style={{
        fontSize: '0.78rem', color: '#94a3b8',
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        trigger_confetti — variant {variant}
      </p>
    </div>
  );
}

// ─── BackgroundColorDisplay ───────────────────────────────────────────────────
// Simulates set_background_color — shows a colour swatch with label

function BackgroundColorDisplay({ color }: { color: string }) {
  const isReset = color.toLowerCase() === 'reset';

  // Resolve named colours to hex for display
  const CSS_COLORS: Record<string, string> = {
    red: '#ef4444', blue: '#3b82f6', green: '#22c55e', yellow: '#eab308',
    purple: '#a855f7', orange: '#f97316', pink: '#ec4899', black: '#1a1a1a',
    white: '#f8fafc', grey: '#6b7280', gray: '#6b7280', brown: '#92400e',
  };
  const resolved = isReset
    ? '#0d1117'
    : CSS_COLORS[color.toLowerCase()] ?? color;

  return (
    <div style={{ width: '100%', textAlign: 'center' }}>
      <div style={{
        width: '100%', height: 100, borderRadius: 10,
        background: resolved,
        border: '2px solid #334155',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: `0 0 30px ${resolved}66`,
        transition: 'background 0.4s ease',
      }}>
        {isReset && (
          <span style={{ color: '#475569', fontSize: '0.78rem', fontFamily: "'JetBrains Mono', monospace" }}>
            screen reset
          </span>
        )}
      </div>
      <p style={{
        marginTop: '0.6rem', fontSize: '0.78rem', color: '#94a3b8',
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        set_background_color — <span style={{ color: resolved === '#0d1117' && !isReset ? '#e2e8f0' : resolved }}>{color}</span>
      </p>
    </div>
  );
}

// ─── PlaySoundDisplay ─────────────────────────────────────────────────────────
// Visual feedback for play_sound — shows which effect fired

function PlaySoundDisplay({ effectName }: { effectName: string }) {
  const emoji = SOUND_EMOJIS[effectName] ?? '🔊';
  const [pulse, setPulse] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setPulse(false), 1200);
    return () => clearTimeout(t);
  }, [effectName]);

  return (
    <div style={{
      width: '100%', textAlign: 'center', padding: '1.25rem',
      background: 'linear-gradient(135deg, #1a2e1a 0%, #0d1117 100%)',
      border: '1px solid #166534', borderRadius: 10,
    }}>
      <div style={{
        fontSize: '3rem', marginBottom: '0.5rem',
        animation: pulse ? 'pulse-dot 0.4s ease-in-out 3' : 'none',
        display: 'inline-block',
      }}>
        {emoji}
      </div>
      <p style={{
        fontSize: '0.9rem', fontWeight: 600, color: '#4ade80', marginBottom: '0.25rem',
      }}>
        Sound Playing
      </p>
      <p style={{
        fontSize: '0.75rem', color: '#475569',
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        play_sound — {effectName}
      </p>
    </div>
  );
}

// ─── ActivityCompleteDisplay ──────────────────────────────────────────────────
// Shown when activity_complete fires — clear success state

function ActivityCompleteDisplay({ activityIndex }: { activityIndex: number | string }) {
  return (
    <div style={{
      width: '100%', textAlign: 'center', padding: '1.5rem',
      background: 'linear-gradient(135deg, #052e16 0%, #0d1117 100%)',
      border: '1px solid #22c55e', borderRadius: 10,
      boxShadow: '0 0 24px rgba(34,197,94,0.15)',
    }}>
      <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🏆</div>
      <p style={{ fontSize: '1rem', fontWeight: 600, color: '#4ade80', marginBottom: '0.25rem' }}>
        Activity Complete!
      </p>
      <p style={{
        fontSize: '0.75rem', color: '#475569',
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        activity_complete — index {activityIndex}
      </p>
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

  // ── show_image ─────────────────────────────────────────────────────────────
  const imageUrl = getStringArgument(latest.args, ['url', 'image_url', 'imageUrl', 'src']);
  if (latest.name === 'show_image' && imageUrl) {
    return <ShowImage url={imageUrl} />;
  }

  // ── generate_image ─────────────────────────────────────────────────────────
  // Scenario A: backend returned a URL in result → use it directly
  // Scenario B: backend cancelled (cancel_on_interruption fired during TTS)
  //             → fall back to Pollinations using the description we captured
  //             during InProgress (always captured before cancellation)
if (latest.name === 'generate_image') {
  const description = getStringArgument(
    latest.args,
    ['description', 'prompt', 'query']
  );

  // ✅ Loading state
  if (latest.status === 'running') {
    return (
      <div style={{ textAlign: 'center', color: '#94a3b8' }}>
        <div
          style={{
            display: 'inline-block',
            width: 24,
            height: 24,
            border: '2px solid #1e293b',
            borderTopColor: '#3b82f6',
            borderRadius: '50%',
            animation: 'spin-ring 0.75s linear infinite',
          }}
        />
        <p style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
          Generating your magic pet...
        </p>
      </div>
    );
  }

  // ✅ Parse result safely
  let parsedResult = latest.result;

  if (typeof parsedResult === 'string') {
    try {
      parsedResult = JSON.parse(parsedResult);
    } catch {
      parsedResult = {};
    }
  }

  const resultUrl = getStringArgument(
    normalizeToolArgs(parsedResult),
    ['url', 'image_url', 'imageUrl', 'src']
  );

  // ✅ Show image ONLY if available
  if (resultUrl) {
    return (
      <ShowImage
        url={resultUrl}
        label={description ?? 'Your magical pet ✨'}
      />
    );
  }

  // ❌ DO NOT show failure immediately
  return null;
}

  // ── show_text ──────────────────────────────────────────────────────────────
  const displayText = getStringArgument(
    latest.args, ['text', 'message', 'content', 'title']
  );
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

  // ── set_background_color ───────────────────────────────────────────────────
  const bgColor = getStringArgument(
    latest.args, ['color_name', 'color', 'colour']
  );
  if (latest.name === 'set_background_color' && bgColor) {
    return <BackgroundColorDisplay color={bgColor} />;
  }

  // ── trigger_confetti ───────────────────────────────────────────────────────
  if (latest.name === 'trigger_confetti') {
    const variant = (latest.args.variant as number) ?? 1;
    return <ConfettiDisplay variant={variant} />;
  }

  // ── play_sound ─────────────────────────────────────────────────────────────
  const effectName = getStringArgument(
    latest.args, ['effect_name', 'sound', 'name']
  );
  if (latest.name === 'play_sound' && effectName) {
    return <PlaySoundDisplay effectName={effectName} />;
  }

  // ── activity_complete ──────────────────────────────────────────────────────
  if (latest.name === 'activity_complete') {
    const activityIndex = latest.args.activity_index ?? latest.args.index ?? '—';
    return <ActivityCompleteDisplay activityIndex={activityIndex as number | string} />;
  }

  // ── Generic fallback for any unrecognised tool ─────────────────────────────
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
      if (data.final === false) return;
      setTranscripts((prev) => {
        const last = prev[prev.length - 1];
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
        // Capture args immediately — critical for generate_image fallback
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
        // Preserve args from InProgress — do not overwrite with empty
        args:      prev.find((c) => c.id === data.tool_call_id)?.args ?? {},
        timestamp: prev.find((c) => c.id === data.tool_call_id)?.timestamp
          ?? new Date().toLocaleTimeString(),
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
      client.disconnect();
    };
  }, [client]);

useEffect(() => {
  const latest = toolCalls[toolCalls.length - 1];
  if (!latest) return;

  if (latest.name === 'generate_image' && latest.status === 'completed') {
    let parsedResult: unknown = latest.result;

    if (typeof parsedResult === 'string') {
      try {
        parsedResult = JSON.parse(parsedResult);
      } catch {
        parsedResult = {};
      }
    }

    const resultRecord =
      parsedResult && typeof parsedResult === 'object'
        ? (parsedResult as Record<string, unknown>)
        : {};

    const imageUrl =
      resultRecord.url ||
      resultRecord.image_url ||
      resultRecord.imageUrl ||
      resultRecord.src;

    if (!imageUrl) return;

    // 🔊 Force bot speech
    (client as unknown as { sendTextMessage?: (text: string) => void })?.sendTextMessage?.(
      "Close your eyes... 3, 2, 1... Open them! Look at your magic pet!"
    );

    // 🎯 Force activity completion via prompt (WEB FIX)
    (client as unknown as { sendTextMessage?: (text: string) => void })?.sendTextMessage?.(
      "Now call the activity_complete tool with activity_index 0"
    );
  }
}, [toolCalls, client]);

useEffect(() => {
  if (!client) return;

  if (transportState === 'connected') {
    // 🎯 Kickstart the conversation
    (client as unknown as { sendTextMessage?: (text: string) => void })?.sendTextMessage?.(
      "Start the activity by introducing yourself as Zubi and ask the child about their magical pet."
    );
  }
}, [transportState, client]);

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
          system_prompt: prompt,
          body: {
            bot_type: 'activity',
            prompt,
            system_prompt: prompt,
          },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Server error (${response.status} ${response.statusText})${text ? `: ${text}` : ''}`
        );
      }

      const data = await response.json() as Record<string, unknown>;
      const roomUrl =
        (typeof data.url === 'string' && data.url) ||
        (typeof data.room_url === 'string' && data.room_url) ||
        (typeof data.roomUrl === 'string' && data.roomUrl) ||
        (typeof data.dailyRoom === 'string' && data.dailyRoom);
      const roomToken =
        (typeof data.token === 'string' && data.token) ||
        (typeof data.dailyToken === 'string' && data.dailyToken);

      if (!roomUrl) {
        throw new Error(
          `Start endpoint did not return a room URL. Response keys: ${Object.keys(data).join(', ') || 'none'}`
        );
      }

      await client.connect({ url: roomUrl, token: roomToken });
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
              <p style={{
                color: '#334155', fontSize: '0.82rem',
                fontFamily: "'JetBrains Mono', monospace", marginTop: '0.5rem',
              }}>
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
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center',
            justifyContent: 'center', padding: '0.5rem',
          }}>
            <ToolOutput toolCalls={toolCalls} />
          </div>
        </SectionCard>

        {/* Tool call log */}
        <SectionCard
          title={`Tool Call Log${toolCalls.length ? ` · ${toolCalls.length} calls` : ''}`}
          style={{ flex: 1, minHeight: 0 }}
        >
          {Object.keys(toolCounts).length > 0 && (
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {Object.entries(toolCounts).map(([name, count]) => (
                <span key={name} style={{
                  background: '#1e293b', border: '1px solid #334155',
                  padding: '0.15rem 0.6rem', borderRadius: '999px',
                  fontSize: '0.75rem', fontFamily: "'JetBrains Mono', monospace",
                  color: '#94a3b8',
                }}>
                  {name} <strong style={{ color: '#e2e8f0' }}>{count}</strong>
                </span>
              ))}
            </div>
          )}

          <div style={{
            flex: 1, overflowY: 'auto', display: 'flex',
            flexDirection: 'column', gap: '0.5rem', paddingRight: '0.25rem',
          }}>
            {toolCalls.length === 0 ? (
              <p style={{
                color: '#334155', fontSize: '0.82rem',
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                No tool calls recorded yet…
              </p>
            ) : (
              toolCalls.slice().reverse().map((call) => (
                <div key={call.id} className="tool-item" style={{
                  padding: '0.7rem 0.85rem', borderRadius: 9, flexShrink: 0,
                  background: '#0d1117', border: '1px solid #1e293b',
                  borderLeft: `3px solid ${STATUS_BORDER[call.status] ?? '#6b7280'}`,
                }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: '0.35rem',
                  }}>
                    <strong style={{
                      color: '#e2e8f0', fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '0.82rem',
                    }}>
                      {call.name}
                    </strong>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <span style={{
                        fontSize: '0.68rem', padding: '0.1rem 0.5rem',
                        borderRadius: '999px', background: '#1e293b',
                        fontFamily: "'JetBrains Mono', monospace",
                        color: STATUS_BORDER[call.status],
                        border: `1px solid ${STATUS_BORDER[call.status]}33`,
                      }}>
                        {call.status}
                      </span>
                      <small style={{
                        color: '#475569', fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '0.7rem',
                      }}>
                        {call.timestamp}
                      </small>
                    </div>
                  </div>
                  <pre style={{
                    fontSize: '0.72rem', background: '#161b27',
                    padding: '0.5rem 0.65rem', borderRadius: 6, margin: 0,
                    overflowX: 'auto', color: '#7dd3fc',
                    fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.5,
                    border: '1px solid #1e293b',
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