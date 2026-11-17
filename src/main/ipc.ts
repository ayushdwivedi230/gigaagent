import fs from 'node:fs';
import { dialog, ipcMain } from 'electron';
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { IPC } from '@shared/ipc';
import { buildSessionExport, exportFileStem } from '@shared/export';
import {
  MAX_AUDIO_CHUNK_BYTES,
  parseAskOptions,
  parseExportRequest,
  parseLibraryQuery,
  parseLibrarySave,
  parseQuestion,
  parseRequestId,
  parseRunTool,
  parseSearchQuery,
  parseSessionId,
  parseStartRequest,
} from '@shared/validation';
import { err, ok, SESSION_MODES } from '@shared/types';
import type { InvisibilityStatus, Result, ScreenAnalysisRequest, SessionEvent, UpdateSettingsRequest, WindowMode } from '@shared/types';
import type { SessionService } from './services/sessionService';
import type { SettingsService } from './services/settingsService';
import type { SystemAudioGate } from './services/systemAudioGate';
import type { SuggestionService } from './services/suggestionService';
import type { ScreenCaptureService } from './services/screenCaptureService';
import type { ScreenContextManager } from './services/screenContextManager';
import type { DiagnosticsService } from './services/diagnosticsService';
import type { WindowInvisibilityService } from './services/windowInvisibilityService';
import type { DecoyCursorService } from './services/decoyCursorService';
import type { LibraryStore } from './services/sessionRepository';
import { logDiag } from './services/diagnosticsLogger';

/** Optional collaborators introduced in 3.0. Passed as one object so the positional signature stays stable. */
export interface IpcExtras {
  library?: LibraryStore;
  /** Flushes and returns the on-disk database path for backups (null when in-memory). */
  getDatabasePath?: () => string | null;
  flushDatabase?: () => void;
  onSettingsChanged?: (before: ReturnType<SettingsService['getPreferences']>) => void;
  setWindowMode?: (mode: WindowMode) => void;
  setAlwaysOnTop?: (value: boolean) => void;
  decoyCursorService?: DecoyCursorService;
  /** Injected for tests. */
  dialogs?: Pick<typeof dialog, 'showSaveDialog'>;
}

const MAX_DIAG_MESSAGE = 500;

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
  screenCaptureService?: ScreenCaptureService,
  screenContextManager?: ScreenContextManager,
  diagnosticsService?: DiagnosticsService,
  windowInvisibilityService?: WindowInvisibilityService,
  extras: IpcExtras = {},
): () => void {
  const trusted = (event: IpcMainInvokeEvent | IpcMainEvent): boolean =>
    !win.isDestroyed() && event.sender === win.webContents && (event.senderFrame === undefined || event.senderFrame === win.webContents.mainFrame);

  const handle = <T>(channel: string, fn: (arg: unknown) => Promise<Result<T>> | Result<T>): void => {
    ipcMain.handle(channel, async (event, arg: unknown): Promise<Result<T>> => {
      if (!trusted(event)) return err('UNTRUSTED_SENDER', 'This request was not accepted.');
      try {
        return await fn(arg);
      } catch (cause) {
        console.error(`[ipc] ${channel} failed`, cause);
        diagnosticsService?.recordError('IPC', 'An internal request failed.', `${channel}: ${cause instanceof Error ? cause.message : String(cause)}`);
        return err('INTERNAL', 'Something went wrong inside the app. Try again.');
      }
    });
  };

  const noAi = (): Result<never> => err('INTERNAL', 'Suggestion service is unavailable.');
  const noLibrary = (): Result<never> => err('INTERNAL', 'The library is unavailable.');
  const dialogs = extras.dialogs ?? dialog;

  // ── Sessions ──────────────────────────────────────────────────────────────
  handle(IPC.sessionStart, (raw) => {
    const parsed = parseStartRequest(raw);
    if (!parsed.ok) return parsed;
    const needsCloudStt = parsed.value.source && parsed.value.source !== 'demo';
    if (needsCloudStt && !settingsService.getPreferences().privacy.allowCloudTranscription && settingsService.getSettings().sttProvider !== 'mock') {
      return err('CONSENT_REQUIRED', 'Cloud transcription is turned off in Settings → Privacy. Turn it on, or switch the speech provider to Local test mode.');
    }
    return service.start(parsed.value);
  });
  handle(IPC.sessionStop, () => service.stop());
  handle(IPC.sessionSnapshot, () => ok(service.getSnapshot()));
  handle(IPC.sessionPause, (raw) => {
    const result = service.setPaused(raw === true);
    if (result.ok) suggestionService?.setPaused(result.value.paused);
    return result;
  });
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
  handle(IPC.historySearch, (raw) => {
    const query = parseSearchQuery(raw);
    if (!query.ok) return query;
    return extras.library ? ok(extras.library.searchTranscripts(query.value, 100)) : noLibrary();
  });

  // ── Settings ──────────────────────────────────────────────────────────────
  handle(IPC.settingsGet, () => ok(settingsService.getClientSettings()));
  handle(IPC.settingsSave, (raw) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return err('INVALID_REQUEST', 'Settings data was malformed.');
    }
    const updates = raw as UpdateSettingsRequest;
    const before = settingsService.getPreferences();
    const saved = settingsService.saveSettings(updates);
    if (typeof updates.screenShareInvisibility === 'boolean' && windowInvisibilityService) {
      windowInvisibilityService.setEnabled(updates.screenShareInvisibility);
    }
    if (typeof updates.geminiApiKey === 'string') {
      diagnosticsService?.setAiStatus(settingsService.getEffectiveGeminiKey() ? 'configured' : 'missing_key');
    }
    extras.onSettingsChanged?.(before);
    return ok(saved);
  });

  // ── Ghost Mode (window capture exclusion) ─────────────────────────────────
  const fallbackGhost = (): InvisibilityStatus => ({
    enabled: false,
    platform: process.platform,
    affinityFlag: 'UNSUPPORTED',
    lastAppliedAt: new Date().toISOString(),
    state: 'unsupported',
    supported: false,
    detail: 'Ghost Mode is unavailable in this build.',
  });
  handle(IPC.invisibilityGet, () => ok(windowInvisibilityService ? windowInvisibilityService.getStatus() : fallbackGhost()));
  handle(IPC.invisibilitySet, (raw) => {
    if (typeof raw !== 'boolean') return err('INVALID_REQUEST', 'Ghost Mode expects on or off.');
    if (!windowInvisibilityService) return err('INTERNAL', 'Window invisibility service is unavailable.');
    const status = windowInvisibilityService.setEnabled(raw);
    // Persist only what actually took effect, so the saved setting never claims more than the OS did.
    if (status.state !== 'error') settingsService.saveSettings({ screenShareInvisibility: raw });
    return ok(status);
  });

  // ── System audio gate ─────────────────────────────────────────────────────
  handle(IPC.systemAudioArm, () => {
    systemAudioGate?.arm();
    return ok({ armed: true });
  });
  handle(IPC.systemAudioDisarm, () => {
    systemAudioGate?.disarm();
    return ok({ armed: false });
  });

  // ── AI ────────────────────────────────────────────────────────────────────
  handle(IPC.geminiTest, (raw) => {
    const question = typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 500) : undefined;
    return suggestionService ? suggestionService.testGeminiConnection(question) : noAi();
  });

  handle(IPC.aiAsk, (raw) => {
    let rawQuestion: unknown = raw;
    let rawOptions: unknown;
    if (typeof raw === 'object' && raw !== null) {
      const payload = raw as { question?: unknown; options?: unknown };
      rawQuestion = payload.question;
      rawOptions = payload.options;
    }
    const question = parseQuestion(rawQuestion);
    if (!question.ok) return question;
    return suggestionService ? suggestionService.askQuestion(question.value, parseAskOptions(rawOptions)) : noAi();
  });

  handle(IPC.aiCancel, (raw) => {
    if (!suggestionService) return noAi();
    if (raw === undefined || raw === null) return ok({ cancelled: suggestionService.cancel() });
    const id = parseRequestId(raw);
    return id.ok ? ok({ cancelled: suggestionService.cancel(id.value) }) : id;
  });

  handle(IPC.aiRunTool, (raw) => {
    const parsed = parseRunTool(raw);
    if (!parsed.ok) return parsed;
    return suggestionService ? suggestionService.runTool(parsed.value) : noAi();
  });

  // ── Screen context ────────────────────────────────────────────────────────
  handle(IPC.screenGetSources, () => {
    return screenCaptureService ? screenCaptureService.getAvailableSources() : err('INTERNAL', 'Screen capture service is unavailable.');
  });

  handle(IPC.screenCapture, async (raw) => {
    const sourceId = typeof raw === 'string' && /^(screen|window):[\w:.-]{1,80}$/.test(raw.trim()) ? raw.trim() : undefined;
    if (!screenCaptureService) return err('INTERNAL', 'Screen capture service is unavailable.');
    const res = await screenCaptureService.capture(sourceId);
    if (res.ok && screenContextManager) screenContextManager.setPending(res.value);
    return res;
  });

  handle(IPC.screenConfirm, (raw) => {
    const screenshotId = typeof raw === 'string' ? raw.trim().slice(0, 100) : '';
    if (!screenshotId) return err('INVALID_REQUEST', 'Invalid screenshot ID.');
    return ok({ confirmed: screenContextManager?.confirm(screenshotId) ?? false });
  });

  handle(IPC.screenDiscard, (raw) => {
    const screenshotId = typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 100) : undefined;
    return ok({ discarded: screenContextManager?.discard(screenshotId) ?? false });
  });

  handle(IPC.screenClearContext, () => {
    screenContextManager?.clear();
    return ok({ cleared: true });
  });

  handle(IPC.screenGetContext, () => ok(screenContextManager?.getConfirmed() ?? null));

  handle(IPC.screenAnalyze, (raw) => {
    if (!suggestionService) return noAi();
    if (typeof raw !== 'object' || raw === null) return err('INVALID_REQUEST', 'Malformed screen analysis request.');
    const input = raw as Record<string, unknown>;
    const question = parseQuestion(input.question);
    if (!question.ok) return question;
    const req: ScreenAnalysisRequest & { requestId?: string } = { question: question.value };
    if (typeof input.mode === 'string' && (SESSION_MODES as readonly string[]).includes(input.mode)) req.mode = input.mode as ScreenAnalysisRequest['mode'] & string;
    if (typeof input.context === 'string') req.context = input.context.slice(-24_000);
    if (typeof input.screenshotId === 'string') req.screenshotId = input.screenshotId.slice(0, 100);
    const requestId = parseRequestId(input.requestId);
    if (requestId.ok) req.requestId = requestId.value;
    return suggestionService.analyzeScreenshot(req);
  });

  // ── Library ───────────────────────────────────────────────────────────────
  handle(IPC.libraryList, (raw) => (extras.library ? ok(extras.library.listLibrary(parseLibraryQuery(raw))) : noLibrary()));
  handle(IPC.librarySave, (raw) => {
    const parsed = parseLibrarySave(raw);
    if (!parsed.ok) return parsed;
    return extras.library ? ok(extras.library.saveLibraryItem(parsed.value)) : noLibrary();
  });
  handle(IPC.libraryDelete, (raw) => {
    const id = parseSessionId(raw);
    if (!id.ok) return err('INVALID_REQUEST', 'The item id was malformed.');
    if (!extras.library) return noLibrary();
    if (settingsService.getPreferences().ai.activeProfileId === id.value) {
      settingsService.saveSettings({ preferences: { ai: { activeProfileId: null } } });
    }
    return ok({ deleted: extras.library.deleteLibraryItem(id.value) ? 1 : 0 });
  });
  handle(IPC.libraryClear, () => {
    if (!extras.library) return noLibrary();
    settingsService.saveSettings({ preferences: { ai: { activeProfileId: null } } });
    return ok({ deleted: extras.library.clearLibrary() });
  });

  // ── Export / data control ─────────────────────────────────────────────────
  handle(IPC.exportSession, async (raw) => {
    const parsed = parseExportRequest(raw);
    if (!parsed.ok) return parsed;
    const detail = service.getSession(parsed.value.sessionId);
    if (!detail.ok) return detail;
    const ext = parsed.value.format === 'markdown' ? 'md' : parsed.value.format === 'json' ? 'json' : 'txt';
    const choice = await dialogs.showSaveDialog(win, {
      title: 'Export session',
      defaultPath: `${exportFileStem(detail.value)}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (choice.canceled || !choice.filePath) return ok({ saved: false });
    const saved = extras.library?.listLibrary({ sessionId: parsed.value.sessionId }) ?? [];
    const content = buildSessionExport(detail.value, saved, parsed.value.format, parsed.value);
    await fs.promises.writeFile(choice.filePath, content, 'utf8');
    return ok({ saved: true, path: choice.filePath });
  });

  handle(IPC.exportBackup, async () => {
    const dbPath = extras.getDatabasePath?.() ?? null;
    if (!dbPath) return err('NOT_FOUND', 'History is running in memory only, so there is no database file to back up.');
    extras.flushDatabase?.();
    if (!fs.existsSync(dbPath)) return err('NOT_FOUND', 'There is no saved data to back up yet.');
    const choice = await dialogs.showSaveDialog(win, {
      title: 'Back up GigaAgent data',
      defaultPath: `gigaagent-backup-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: 'SQLite database', extensions: ['db'] }],
    });
    if (choice.canceled || !choice.filePath) return ok({ saved: false });
    await fs.promises.copyFile(dbPath, choice.filePath);
    return ok({ saved: true, path: choice.filePath });
  });

  handle(IPC.dataWipe, () => {
    const cleared = service.clearHistory();
    if (!cleared.ok) return cleared;
    const libraryItems = extras.library?.clearLibrary() ?? 0;
    screenContextManager?.clear();
    settingsService.saveSettings({ preferences: { ai: { activeProfileId: null } } });
    return ok({ sessions: cleared.value.deleted, libraryItems });
  });

  // ── Diagnostics ───────────────────────────────────────────────────────────
  handle(IPC.diagnosticsGet, () => (diagnosticsService ? ok(diagnosticsService.getSnapshot()) : err('INTERNAL', 'Diagnostics service is unavailable.')));
  handle(IPC.diagnosticsExport, () => (diagnosticsService ? ok(diagnosticsService.exportDiagnostics()) : err('INTERNAL', 'Diagnostics service is unavailable.')));

  const onDiagLog = (event: IpcMainEvent, category: unknown, message: unknown, data: unknown): void => {
    if (!trusted(event)) return;
    if (typeof category !== 'string' || typeof message !== 'string') return;
    let safeData: Record<string, unknown> | undefined;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      try {
        const json = JSON.stringify(data);
        if (json.length <= 2000) safeData = JSON.parse(json) as Record<string, unknown>;
      } catch {
        safeData = undefined;
      }
    }
    logDiag(`Renderer:${category.slice(0, 60)}`, message.slice(0, MAX_DIAG_MESSAGE), safeData);
  };
  ipcMain.on(IPC.diagLog, onDiagLog);

  // ── Audio ─────────────────────────────────────────────────────────────────
  const onAudioChunk = (event: IpcMainEvent, arg1: unknown, arg2?: unknown): void => {
    if (!trusted(event)) return;
    if (service.isPaused()) return; // paused: audio is discarded, never forwarded
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
    // 100 ms of 16 kHz mono PCM is 3.2 KB; anything far larger is malformed.
    if (!chunkBuffer || chunkBuffer.byteLength === 0 || chunkBuffer.byteLength > MAX_AUDIO_CHUNK_BYTES) return;

    const target = activeSource as { pushAudioChunk: (a: 'mic' | 'system' | ArrayBuffer, b?: ArrayBuffer) => void };
    target.pushAudioChunk(sourceKind, chunkBuffer);
  };
  ipcMain.on(IPC.audioChunk, onAudioChunk);

  const send = (event: SessionEvent): void => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(IPC.event, event);
  };
  const unsubscribe = service.subscribe(send);

  // ── Window ────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.windowMinimize, (event) => {
    if (trusted(event)) win.minimize();
  });
  ipcMain.handle(IPC.windowClose, (event) => {
    if (trusted(event)) win.close();
  });
  handle(IPC.windowSetMode, (raw) => {
    if (raw !== 'compact' && raw !== 'expanded') return err('INVALID_REQUEST', 'Unknown window mode.');
    settingsService.saveSettings({ preferences: { layout: { expanded: raw === 'expanded' } } });
    extras.setWindowMode?.(raw);
    send({ type: 'window-mode', mode: raw });
    return ok({ mode: raw as WindowMode });
  });
  handle(IPC.windowSetAlwaysOnTop, (raw) => {
    if (typeof raw !== 'boolean') return err('INVALID_REQUEST', 'Expected on or off.');
    settingsService.saveSettings({ preferences: { layout: { alwaysOnTop: raw } } });
    extras.setAlwaysOnTop?.(raw);
    return ok({ alwaysOnTop: raw });
  });
  handle(IPC.windowSetIgnoreMouseEvents, (raw) => {
    if (typeof raw !== 'object' || raw === null) return err('INVALID_REQUEST', 'Expected object.');
    const { ignore, forward } = raw as { ignore: boolean; forward?: boolean };
    if (typeof ignore !== 'boolean') return err('INVALID_REQUEST', 'Expected ignore boolean.');
    if (!win.isDestroyed()) {
      try {
        win.setIgnoreMouseEvents(ignore, { forward: forward ?? true });
      } catch (cause) {
        return err('INTERNAL', 'Failed to update window mouse events: ' + String(cause));
      }
    }
    return ok({ ignore, forward: forward ?? true });
  });
  handle(IPC.decoyCursorShow, (raw) => {
    if (typeof raw !== 'object' || raw === null) return err('INVALID_REQUEST', 'Expected object with coordinates.');
    const { x, y } = raw as { x: number; y: number };
    if (typeof x !== 'number' || typeof y !== 'number') return err('INVALID_REQUEST', 'Expected x and y numbers.');
    extras.decoyCursorService?.showAt(x, y);
    return ok({ shown: true });
  });
  handle(IPC.decoyCursorHide, () => {
    extras.decoyCursorService?.hide();
    return ok({ hidden: true });
  });

  return () => {
    unsubscribe();
    ipcMain.removeListener(IPC.audioChunk, onAudioChunk);
    ipcMain.removeListener(IPC.diagLog, onDiagLog);
    for (const channel of Object.values(IPC)) ipcMain.removeHandler(channel);
  };
}
