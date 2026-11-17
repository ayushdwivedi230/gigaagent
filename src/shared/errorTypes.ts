export type ErrorCategory =
  | 'AUDIO'
  | 'TRANSCRIPTION'
  | 'AI_PROVIDER'
  | 'SCREEN_CAPTURE'
  | 'DATABASE'
  | 'IPC'
  | 'RENDERER'
  | 'LIFECYCLE';

export interface ClassifiedError {
  category: ErrorCategory;
  userMessage: string;
  technicalDetails?: string;
  timestamp: string;
}

export interface DiagnosticsSnapshot {
  appVersion: string;
  electronVersion: string;
  nodeVersion: string;
  osPlatform: string;
  osRelease: string;
  audioCaptureStatus: 'idle' | 'capturing' | 'error';
  sttConnectionStatus: 'connected' | 'connecting' | 'disconnected' | 'mock' | 'error';
  aiProviderStatus: 'configured' | 'missing_key' | 'error';
  databaseHealth: 'healthy' | 'corrupted' | 'recovered' | 'in_memory';
  lastError?: ClassifiedError;
  uptimeSeconds: number;
  // ── 3.0 additions (optional so older snapshots/tests stay valid) ──
  recentErrors?: ClassifiedError[];
  ai?: AiUsage | undefined;
  memory?: { rssMb: number; heapUsedMb: number };
  ghost?: import('./types').InvisibilityStatus | undefined;
  credentialStorage?: import('./types').CredentialStorage;
  microphonePermission?: string;
  processes?: Array<{ type: string; memoryMb: number; cpuPercent: number }>;
}

/** Local-only counters for this run. Nothing here is transmitted anywhere. */
export interface AiUsage {
  requests: number;
  failures: number;
  cancelled: number;
  lastLatencyMs: number | null;
  lastModel: string | null;
  promptTokens: number;
  outputTokens: number;
}

export type DiagnosticsExtras = Pick<DiagnosticsSnapshot, 'ghost' | 'credentialStorage' | 'microphonePermission' | 'processes'>;

