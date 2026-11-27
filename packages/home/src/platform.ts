/*
 * The slice of the Claude page runtime Home uses (`claude.use` → mcp, db, user, desktop), typed from the
 * platform's own definitions (artifact-capabilities claude.d.ts, mcp.d.ts, db.d.ts, user.d.ts, desktop.d.ts).
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

/**
 * The `desktop` capability (desktop.d.ts): outside an installed app's window only `install` exists;
 * inside it, `app.dock` too (its icon and badge). Home asks for no desktop permission, so nothing else is used.
 */
export interface Desktop {
  install: {
    state(): Promise<'available' | 'installed' | 'unavailable'>;
    request(): Promise<'installed' | 'cancelled' | 'unavailable' | 'failed'>;
  };
  app?: { dock: { setIcon(pngDataUrl: string): Promise<{ written: boolean }>; setBadge(text: string): Promise<boolean> } };
}

export interface CapabilityMap {
  mcp: Mcp;
  db: Db;
  user: User;
  desktop: Desktop;
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
