import type { ToolCall } from './types';

// ─── Tool call helpers ────────────────────────────────────────────────────────

export function normalizeToolName(value?: string): string {
  return value?.trim() || 'unknown_tool';
}

export function normalizeToolArgs(input: unknown): Record<string, unknown> {
  if (!input) return {};
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : { value: parsed };
    } catch {
      return { value: input };
    }
  }
  if (typeof input === 'object') return input as Record<string, unknown>;
  return { value: input };
}

export function upsertToolCall(prev: ToolCall[], next: ToolCall): ToolCall[] {
  const idx = prev.findIndex((c) => c.id === next.id);
  if (idx === -1) return [...prev, next];
  const updated = [...prev];
  updated[idx] = { ...updated[idx], ...next };
  return updated;
}

export function getStringArgument(
  args: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

// ─── URL helpers ──────────────────────────────────────────────────────────────

export function resolveStartUrl(rawUrl?: string): string {
  const url = rawUrl?.trim();
  if (!url) return '/start';
  if (/\/start\/?$/i.test(url)) return url;
  return `${url.replace(/\/+$/, '')}/start`;
}

// ─── Theme constants ──────────────────────────────────────────────────────────

export const STATE_COLORS: Record<string, string> = {
  ready:         '#22c55e',
  connected:     '#22c55e',
  connecting:    '#f59e0b',
  disconnecting: '#f59e0b',
  disconnected:  '#6b7280',
  error:         '#ef4444',
};

export const STATUS_BORDER: Record<string, string> = {
  completed: '#22c55e',
  cancelled: '#ef4444',
  running:   '#f59e0b',
};

// ─── Shared style objects ─────────────────────────────────────────────────────

export const MONO: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
};

export const cardStyle: React.CSSProperties = {
  background: '#161b27',
  border: '1px solid #1e293b',
  borderRadius: 12,
  padding: '1rem 1.25rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
};

export const cardTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.72rem',
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: '#475569',
};

export const emptyTextStyle: React.CSSProperties = {
  color: '#334155',
  fontSize: '0.82rem',
  fontFamily: "'JetBrains Mono', monospace",
};

export const pillStyle: React.CSSProperties = {
  background: '#1e293b',
  border: '1px solid #334155',
  padding: '0.15rem 0.6rem',
  borderRadius: '999px',
  fontSize: '0.75rem',
  fontFamily: "'JetBrains Mono', monospace",
  color: '#94a3b8',
};

export const preStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  background: '#0d1117',
  padding: '0.5rem 0.65rem',
  borderRadius: 6,
  margin: 0,
  overflowX: 'auto',
  color: '#7dd3fc',
  fontFamily: "'JetBrains Mono', monospace",
  lineHeight: 1.5,
  border: '1px solid #1e293b',
};