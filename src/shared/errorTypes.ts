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
}
