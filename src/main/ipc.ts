import { ipcMain } from 'electron';
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { IPC } from '@shared/ipc';
import { parseSessionId, parseStartRequest } from '@shared/validation';
import { err, ok } from '@shared/types';
import type { Result, UpdateSettingsRequest } from '@shared/types';
import type { SessionService } from './services/sessionService';
import type { SettingsService } from './services/settingsService';
import type { SystemAudioGate } from './services/systemAudioGate';
import type { SuggestionService } from './services/suggestionService';
import { logDiag } from './services/diagnosticsLogger';

/**
 * Registers request/response handlers and forwards service events to the window.
 * Every handler (1) rejects callers other than our own window, (2) validates input,
 * (3) never lets an exception escape as a raw error string.
 */
export function registerIpc(
  win: BrowserWindow,
  service: SessionService,
  settingsService: SettingsService,
  systemAudioGate?: SystemAudioGate,
  suggestionService?: SuggestionService,
): () => void {
  const trusted = (event: IpcMainInvokeEvent | IpcMainEvent): boolean =>
    !win.isDestroyed() && event.sender === win.webContents;

  const handle = <T>(channel: string, fn: (arg: unknown) => Promise<Result<T>> | Result<T>): void => {
    ipcMain.handle(channel, async (event, arg: unknown): Promise<Result<T>> => {
      if (!trusted(event)) return err('UNTRUSTED_SENDER', 'This request was not accepted.');
      try {
        return await fn(arg);
      } catch (cause) {
        console.error(`[ipc] ${channel} failed`, cause);
        return err('INTERNAL', 'Something went wrong inside the app. Try again.');
      }
    });
  };

  handle(IPC.sessionStart, (raw) => {
    const parsed = parseStartRequest(raw);
    return parsed.ok ? service.start(parsed.value) : parsed;
  });
  handle(IPC.sessionStop, () => service.stop());
  handle(IPC.sessionSnapshot, () => ok(service.getSnapshot()));
  handle(IPC.historyList, () => ok(service.listSessions()));
  handle(IPC.historyGet, (raw) => {
    const id = parseSessionId(raw);
    return id.ok ? service.getSession(id.value) : id;
  });
  handle(IPC.historyDelete, (raw) => {
    const id = parseSessionId(raw);
    return id.ok ? service.deleteSession(id.value) : id;
  });
  handle(IPC.historyClear, () => service.clearHistory());

  handle(IPC.settingsGet, () => ok(settingsService.getClientSettings()));
  handle(IPC.settingsSave, (raw) => {
    if (typeof raw !== 'object' || raw === null) {
      return err('INVALID_REQUEST', 'Settings data was malformed.');
    }
    return ok(settingsService.saveSettings(raw as UpdateSettingsRequest));
  });

  handle(IPC.systemAudioArm, () => {
    systemAudioGate?.arm();
    return ok({ armed: true });
  });
  handle(IPC.systemAudioDisarm, () => {
    systemAudioGate?.disarm();
    return ok({ armed: false });
  });

  handle(IPC.geminiTest, (raw) => {
    const question = typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
    return suggestionService
      ? suggestionService.testGeminiConnection(question)
      : err('INTERNAL', 'Suggestion service is unavailable.');
  });

  handle(IPC.aiAsk, (raw: unknown) => {
    let question = '';
    let options: {
      mode?: import('@shared/types').SessionMode;
      context?: string;
      formatType?: string;
    } = {};

    if (typeof raw === 'string') {
      question = raw.trim();
    } else if (raw && typeof raw === 'object' && 'question' in raw) {
      const payload = raw as {
        question: unknown;
        options?: {
          mode?: import('@shared/types').SessionMode;
          context?: string;
          formatType?: string;
        };
      };
      question = typeof payload.question === 'string' ? payload.question.trim() : '';
      if (payload.options && typeof payload.options === 'object') {
        options = payload.options;
      }
    }

    if (!question) {
      return err('INVALID_REQUEST', 'Question cannot be empty.');
    }

    return suggestionService
      ? suggestionService.askQuestion(question, options)
      : err('INTERNAL', 'Suggestion service is unavailable.');
  });

  ipcMain.on(IPC.diagLog, (_event, category: unknown, message: unknown, data: unknown) => {
    if (typeof category === 'string' && typeof message === 'string') {
      logDiag(category, message, data && typeof data === 'object' ? (data as Record<string, unknown>) : undefined);
    }
  });

  const onAudioChunk = (
    event: IpcMainEvent,
    arg1: unknown,
    arg2?: unknown,
  ): void => {
    if (!trusted(event)) return;
    const activeSource = service.getActiveSource();
    if (!activeSource || !('pushAudioChunk' in activeSource)) return;

    let sourceKind: 'mic' | 'system' = 'mic';
    let rawChunk: unknown = arg1;

    if (arg1 === 'mic' || arg1 === 'system') {
      sourceKind = arg1;
      rawChunk = arg2;
    }

    let chunkBuffer: ArrayBuffer | null = null;
    if (rawChunk instanceof ArrayBuffer) {
      chunkBuffer = rawChunk;
    } else if (ArrayBuffer.isView(rawChunk)) {
      const copy = new Uint8Array(rawChunk.byteLength);
      copy.set(new Uint8Array(rawChunk.buffer, rawChunk.byteOffset, rawChunk.byteLength));
      chunkBuffer = copy.buffer as ArrayBuffer;
    }

    if (chunkBuffer) {
      const target = activeSource as {
        pushAudioChunk: (a: 'mic' | 'system' | ArrayBuffer, b?: ArrayBuffer) => void;
      };
      target.pushAudioChunk(sourceKind, chunkBuffer);
    }
  };
  ipcMain.on(IPC.audioChunk, onAudioChunk);

  const unsubscribe = service.subscribe((event) => {
    if (!win.isDestroyed()) win.webContents.send(IPC.event, event);
  });

  // Frameless window controls
  ipcMain.handle(IPC.windowMinimize, (event) => {
    if (trusted(event)) win.minimize();
  });
  ipcMain.handle(IPC.windowClose, (event) => {
    if (trusted(event)) win.close();
  });

  return () => {
    unsubscribe();
    ipcMain.removeListener(IPC.audioChunk, onAudioChunk);
    for (const channel of Object.values(IPC)) ipcMain.removeHandler(channel);
  };
}
