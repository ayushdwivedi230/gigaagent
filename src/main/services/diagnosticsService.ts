import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ClassifiedError, DiagnosticsSnapshot, ErrorCategory } from '@shared/errorTypes';
import { logDiag } from './diagnosticsLogger';

export interface DiagnosticsServiceOptions {
  userDataDir: string;
  appVersion?: string;
  electronVersion?: string;
}

export class DiagnosticsService {
  private readonly userDataDir: string;
  private readonly appVersion: string;
  private readonly electronVersion: string;
  private readonly startTime = Date.now();

  private audioCaptureStatus: 'idle' | 'capturing' | 'error' = 'idle';
  private sttConnectionStatus: 'connected' | 'connecting' | 'disconnected' | 'mock' | 'error' = 'disconnected';
  private aiProviderStatus: 'configured' | 'missing_key' | 'error' = 'missing_key';
  private databaseHealth: 'healthy' | 'corrupted' | 'recovered' | 'in_memory' = 'healthy';
  private lastError?: ClassifiedError;

  constructor(options: DiagnosticsServiceOptions) {
    this.userDataDir = options.userDataDir;
    this.appVersion = options.appVersion ?? '0.1.0';
    this.electronVersion = options.electronVersion ?? (process.versions.electron || 'unknown');
  }

  setAudioStatus(status: 'idle' | 'capturing' | 'error'): void {
    this.audioCaptureStatus = status;
  }

  setSttStatus(status: 'connected' | 'connecting' | 'disconnected' | 'mock' | 'error'): void {
    this.sttConnectionStatus = status;
  }

  setAiStatus(status: 'configured' | 'missing_key' | 'error'): void {
    this.aiProviderStatus = status;
  }

  setDatabaseHealth(health: 'healthy' | 'corrupted' | 'recovered' | 'in_memory'): void {
    this.databaseHealth = health;
  }

  recordError(category: ErrorCategory, userMessage: string, technicalDetails?: string): ClassifiedError {
    const scrubbedDetails = technicalDetails
      ? technicalDetails
          .replace(/[a-zA-Z0-9_-]{25,}/g, '[REDACTED_TOKEN]')
          .replace(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/g, '[REDACTED_IMAGE_DATA]')
      : undefined;

    const classified: ClassifiedError = {
      category,
      userMessage,
      technicalDetails: scrubbedDetails,
      timestamp: new Date().toISOString(),
    };

    this.lastError = classified;
    logDiag(`Error:${category}`, userMessage, { technicalDetails: scrubbedDetails });
    return classified;
  }

  getSnapshot(): DiagnosticsSnapshot {
    return {
      appVersion: this.appVersion,
      electronVersion: this.electronVersion,
      nodeVersion: process.version,
      osPlatform: os.platform(),
      osRelease: os.release(),
      audioCaptureStatus: this.audioCaptureStatus,
      sttConnectionStatus: this.sttConnectionStatus,
      aiProviderStatus: this.aiProviderStatus,
      databaseHealth: this.databaseHealth,
      lastError: this.lastError,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }

  exportDiagnostics(): { exportedPath: string; content: string } {
    const snapshot = this.getSnapshot();
    const exportData = {
      generatedAt: new Date().toISOString(),
      diagnostics: snapshot,
    };

    const fileName = `diagnostics-export-${Date.now()}.json`;
    const exportedPath = path.join(this.userDataDir, fileName);
    const content = JSON.stringify(exportData, null, 2);

    fs.writeFileSync(exportedPath, content, 'utf8');
    logDiag('Diagnostics:Export', 'Diagnostic report exported successfully', { exportedPath });

    return { exportedPath, content };
  }
}
