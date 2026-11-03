import fs from 'node:fs';
import path from 'node:path';

let logFilePath: string | null = null;

export function initDiagnosticsLogger(userDataDir: string): void {
  try {
    logFilePath = path.join(userDataDir, 'diagnostics.log');
    fs.appendFileSync(
      logFilePath,
      `\n=== GigaAgent Diagnostics Started [${new Date().toISOString()}] ===\n`,
    );
  } catch (err) {
    console.warn('[DiagnosticsLogger] Failed to initialize log file', err);
  }
}

export function logDiag(category: string, message: string, data?: Record<string, unknown>): void {
  const ts = new Date().toISOString().split('T')[1]?.replace('Z', '') || '';
  const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
  const line = `[${ts}][${category}] ${message}${dataStr}`;

  console.log(line);

  if (logFilePath) {
    try {
      fs.appendFileSync(logFilePath, `${line}\n`);
    } catch {
      // Ignore file append errors
    }
  }
}
