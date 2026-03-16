// ─── Domain types ─────────────────────────────────────────────────────────────

export interface Transcript {
  speaker: 'user' | 'bot';
  text: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  timestamp: string;
  status: 'running' | 'completed' | 'cancelled';
  result?: unknown;
}

// ─── Pipecat event payloads ───────────────────────────────────────────────────

export interface TranscriptEvent {
  text: string;
  final?: boolean;
}

export interface FunctionCallInProgressEvent {
  function_name?: string;
  tool_call_id: string;
  arguments?: Record<string, unknown>;
}

export interface FunctionCallDeprecatedEvent {
  function_name?: string;
  tool_call_id: string;
  args?: Record<string, unknown> | string;
}

export interface FunctionCallStoppedEvent {
  function_name?: string;
  tool_call_id: string;
  cancelled: boolean;
  result?: unknown;
}