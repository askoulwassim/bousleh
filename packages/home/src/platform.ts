/*
 * The slice of the Claude page runtime Home uses (`claude.use` → mcp, db, user, desktop, sample,
 * dictation, tts), typed from the platform's own definitions (runtime contract 0.2.99: claude.d.ts,
 * mcp.d.ts, db.d.ts, user.d.ts, desktop.d.ts, sample.d.ts, dictation.d.ts, tts.d.ts).
 * Only what Home calls is declared here.
 */

export interface McpError {
  code: string;
  message: string;
  server?: string;
  retryable?: boolean;
  retryAfterMs?: number;
  result?: unknown;
}

export interface CallToolResult {
  content: unknown[];
  structuredContent?: unknown;
  payload?: unknown;
  cache?: { storedAt: number; revalidating: boolean };
}

export type WatchEvent = { type: 'data'; result: CallToolResult } | { type: 'error'; error: McpError };

export interface Mcp {
  callTool(
    server: string,
    tool: string,
    input?: unknown,
    options?: { cache?: false | { staleTime?: number; gcTime?: number; refresh?: boolean } },
  ): Promise<CallToolResult>;
  watchTool(
    server: string,
    tool: string,
    input: unknown,
    handler: (ev: WatchEvent) => void,
    options?: { cache?: { staleTime?: number; gcTime?: number }; refetchInterval?: number },
  ): () => void;
  invalidate(server?: string, tool?: string, input?: unknown): Promise<void>;
}

export interface DocumentSnapshot {
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}

export interface DocumentReference {
  get(): Promise<DocumentSnapshot>;
  set(data: Record<string, unknown>): Promise<void>;
}

export interface Db {
  doc(path: string): DocumentReference;
}

export interface User {
  isOwner(): Promise<boolean>;
}

// ---------------------------------------------------------------- desktop

/** The permissions Home declares in its manifest tag; the platform has two more (overlay, notifications) Home never uses. */
export type DesktopPermission = 'full-access' | 'menu-bar' | 'shortcuts';
export type PermissionState = 'granted' | 'prompt' | 'denied' | 'unavailable';

export interface TrayMenuItem {
  label?: string;
  type?: 'normal' | 'separator';
  enabled?: boolean;
  click?: () => void;
}

export interface ChildProcess {
  stdout: { on(event: 'data', listener: (chunk: string) => void): void };
  stderr: { on(event: 'data', listener: (chunk: string) => void): void };
  on(event: 'exit' | 'close', listener: (code: number | null, signal: string | null) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  kill(signal?: 'SIGTERM' | 'SIGKILL' | 'SIGINT' | 'SIGHUP'): Promise<unknown>;
}

/**
 * The `desktop` capability. Outside an installed app's window only `install` exists; in it, the rest.
 * Every call can reject with an Error whose message starts with an errno-style code (EPERM, ENOENT…).
 */
export interface Desktop {
  install: {
    state(): Promise<'available' | 'installed' | 'unavailable'>;
    request(): Promise<'installed' | 'cancelled' | 'unavailable' | 'failed'>;
  };
  permissions?: {
    state(): Promise<Record<string, PermissionState>>;
    request(names?: DesktopPermission[]): Promise<Record<string, PermissionState>>;
    manage(): Promise<void>;
  };
  window?: { show(): Promise<void> };
  app?: { dock: { setIcon(pngDataUrl: string): Promise<{ written: boolean }>; setBadge(text: string): Promise<boolean> } };
  /** Needs full-access. */
  fs?: { readFile(path: string, encoding: 'utf8'): Promise<string> };
  /** Needs full-access. */
  childProcess?: {
    exec(command: string, options?: { cwd?: string; timeout?: number }): Promise<{ stdout: string; stderr: string; code: number | null }>;
    spawn(command: string, args?: string[], options?: { cwd?: string; shell?: boolean }): ChildProcess;
  };
  os?: { platform(): Promise<string> };
  /** register needs shortcuts. */
  globalShortcut?: {
    register(accelerator: string, callback: () => void): Promise<boolean>;
    unregister(accelerator: string): Promise<void>;
  };
  /** set needs menu-bar. */
  tray?: {
    set(options: { icon?: string; iconIsTemplate?: boolean; title?: string; toolTip?: string; menu?: TrayMenuItem[] }): Promise<boolean>;
    remove(): Promise<void>;
  };
}

// ---------------------------------------------------------------- sample

export interface SampleTool {
  name: string;
  description: string;
  inputSchema?: { type: 'object'; properties?: Record<string, unknown>; required?: string[] };
  execute(input: Record<string, unknown>, context: { signal: AbortSignal }): unknown;
}

export interface SampleOptions {
  signal?: AbortSignal;
  tools?: SampleTool[];
  modelTier?: 'default' | 'complex' | 'quick';
  cache?: boolean;
}

export interface SampleError {
  code: string;
  message: string;
  text?: string;
}

/** `sample`: ask Claude, on the viewer's own account. Home only uses `json`. */
export interface Sample {
  json<T = unknown>(input: string, options?: SampleOptions): Promise<T>;
}

// ---------------------------------------------------------------- dictation and tts

export interface Dictation {
  start(options?: { language?: string }): Promise<void>;
  stop(): Promise<void>;
  onPartial(handler: (e: { text: string }) => void): () => void;
  onFinal(handler: (e: { text: string }) => void): () => void;
  onState(handler: (e: { state: 'idle' | 'starting' | 'listening' | 'finishing'; reason?: string }) => void): () => void;
}

export interface Tts {
  speak(text: string): Promise<{ playedMs: number }>;
  stop(): Promise<void>;
  onState(handler: (e: { state: 'idle' | 'starting' | 'speaking' | 'paused'; reason?: string }) => void): () => void;
}

export interface CapabilityMap {
  mcp: Mcp;
  db: Db;
  user: User;
  desktop: Desktop;
  sample: Sample;
  dictation: Dictation;
  tts: Tts;
}

export interface ClaudeRuntime {
  use<K extends keyof CapabilityMap>(name: K): Promise<CapabilityMap[K] | null>;
}

/** `window.claude`, when the page runs inside a Claude viewer; undefined in any other copy of the page. */
export function runtime(): ClaudeRuntime | undefined {
  const claude = (globalThis as { claude?: unknown }).claude;
  if (typeof claude === 'object' && claude !== null && typeof (claude as { use?: unknown }).use === 'function')
    return claude as ClaudeRuntime;
  return undefined;
}
