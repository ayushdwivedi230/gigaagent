import path from 'node:path';
import { app, safeStorage, session as electronSession } from 'electron';
import type { BrowserWindow } from 'electron';
import { registerIpc } from './ipc';
import { APP_NAME, createMainWindow } from './window';
import { DemoTranscriptSource } from './services/demoTranscriptSource';
import { MicrophoneTranscriptSource } from './services/microphoneTranscriptSource';
import { SystemAudioTranscriptSource } from './services/systemAudioTranscriptSource';
import { CompositeTranscriptSource } from './services/compositeTranscriptSource';
import { SystemAudioGate } from './services/systemAudioGate';
import { InMemorySessionRepository } from './services/sessionRepository';
import type { SessionRepository } from './services/sessionRepository';
import { SqliteSessionRepository } from './services/sqliteSessionRepository';
import { SessionService } from './services/sessionService';
import { SettingsService } from './services/settingsService';
import { SuggestionService } from './services/suggestionService';
import { ScreenCaptureService } from './services/screenCaptureService';
import { ScreenContextManager } from './services/screenContextManager';
import { DiagnosticsService } from './services/diagnosticsService';
import { initDiagnosticsLogger, logDiag } from './services/diagnosticsLogger';
import type { SessionSnapshot } from '@shared/types';

let mainWindow: BrowserWindow | null = null;
let settingsService: SettingsService;
let repository: SessionRepository;
let service: SessionService;
let suggestionService: SuggestionService;
let diagnosticsService: DiagnosticsService;
const systemAudioGate = new SystemAudioGate();
const screenContextManager = new ScreenContextManager();
const screenCaptureService = new ScreenCaptureService();

async function initServices(): Promise<void> {
  const userDataDir = app.getPath('userData');
  initDiagnosticsLogger(userDataDir);
  diagnosticsService = new DiagnosticsService({ userDataDir });
  logDiag('Lifecycle', 'Initializing services in main process', { userDataDir });

  process.on('uncaughtException', (err) => {
    logDiag('Process:UncaughtException', 'Unhandled exception in main process', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    diagnosticsService?.recordError('LIFECYCLE', 'Internal error occurred in main process', String(err));
  });

  process.on('unhandledRejection', (reason) => {
    logDiag('Process:UnhandledRejection', 'Unhandled promise rejection in main process', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
    diagnosticsService?.recordError('LIFECYCLE', 'Unhandled background task error', String(reason));
  });

  const settingsPath = path.join(userDataDir, 'settings.json');
  settingsService = new SettingsService(settingsPath, safeStorage);
  if (settingsService.getEffectiveGeminiKey()) {
    diagnosticsService.setAiStatus('configured');
  }

  const dbPath = path.join(userDataDir, 'sessions.db');
  try {
    repository = await SqliteSessionRepository.create({ filePath: dbPath });
    diagnosticsService.setDatabaseHealth(repository.getHealth?.() ?? 'healthy');
  } catch (err) {
    console.error('[Main] Failed to initialize SQLite repository, falling back to in-memory', err);
    repository = new InMemorySessionRepository();
    diagnosticsService.setDatabaseHealth('in_memory');
    diagnosticsService.recordError('DATABASE', 'Failed to load SQLite file, running in-memory', String(err));
  }

  service = new SessionService({
    repository,
    createSource: (_mode, sourceKind) => {
      if (sourceKind === 'microphone') {
        return new MicrophoneTranscriptSource({ settingsService });
      }
      if (sourceKind === 'system') {
        return new SystemAudioTranscriptSource({ settingsService });
      }
      if (sourceKind === 'both') {
        return new CompositeTranscriptSource({ settingsService });
      }
      return new DemoTranscriptSource();
    },
  });

  suggestionService = new SuggestionService({
    settingsService,
    screenContextManager,
    onSuggestion: (suggestion) => {
      service.emitEvent({ type: 'suggestion', suggestion });
    },
  });

  service.subscribe((event) => {
    if (event.type === 'status') {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setTitle(titleFor(event.snapshot));
      }
      if (event.snapshot.status === 'active') {
        diagnosticsService?.setAudioStatus('capturing');
      } else if (event.snapshot.status === 'idle') {
        diagnosticsService?.setAudioStatus('idle');
      }
      suggestionService.setSession(
        event.snapshot.activeSession?.id ?? null,
        event.snapshot.activeSession?.mode ?? 'mock-interview',
      );
    } else if (event.type === 'segment') {
      suggestionService.handleSegment(event.segment);
    } else if (event.type === 'error') {
      diagnosticsService?.recordError('AUDIO', event.error.message);
    }
  });
}

/** The window title doubles as a taskbar-visible recording indicator. */
function titleFor(snapshot: SessionSnapshot): string {
  const session = snapshot.activeSession;
  if (snapshot.status === 'idle' || !session) return APP_NAME;
  if (snapshot.status === 'active') {
    let label = 'Demo session';
    if (session.source === 'microphone') label = 'Recording (Mic)';
    else if (session.source === 'system') label = 'Recording (System)';
    else if (session.source === 'both') label = 'Recording (Mic + System)';
    return `● ${label} — ${APP_NAME}`;
  }
  return `${snapshot.status === 'starting' ? 'Starting' : 'Stopping'}… — ${APP_NAME}`;
}

/** Deny permissions by default, but permit audio microphone access and authenticated display media loopback capture. */
function configurePermissions(win: BrowserWindow): void {
  const ses = electronSession.defaultSession;
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    logDiag('SysAudioDiag:00-PermissionRequest', 'Permission request received', {
      permission,
      details,
      isMainWindow: webContents === win.webContents,
    });

    if (webContents !== win.webContents) {
      return callback(false);
    }

    // Permit media and display-capture for authenticated main window
    if (permission === 'media' || (permission as string) === 'display-capture') {
      return callback(true);
    }

    callback(false);
  });

  ses.setPermissionCheckHandler((webContents, permission, origin, details) => {
    logDiag('SysAudioDiag:00-PermissionCheck', 'Permission check received', {
      permission,
      origin,
      details,
      isMainWindow: webContents === win.webContents,
    });

    if (webContents !== win.webContents) {
      return false;
    }

    if ((permission as string) === 'display-capture' || permission === 'media') {
      return true;
    }

    return false;
  });

  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    logDiag('SysAudioDiag:02-DisplayMedia', 'Main process received setDisplayMedia request', {
      securityOrigin: request.securityOrigin,
      videoRequested: request.videoRequested,
      audioRequested: request.audioRequested,
      userGesture: request.userGesture,
    });

    const validation = systemAudioGate.validateRequest(request, win);
    if (!validation.valid) {
      logDiag('SysAudioDiag:02-DisplayMedia', 'Capture request REJECTED', { reason: validation.reason });
      console.warn('[DisplayMedia] Capture request denied:', validation.reason);
      return callback({});
    }

    const screenSource = await systemAudioGate.selectDesktopSource();
    if (!screenSource) {
      logDiag('SysAudioDiag:02-DisplayMedia', 'Capture request FAILED: no screen capture source found');
      console.warn('[DisplayMedia] No screen capture source found');
      return callback({});
    }

    // Pass loopback audio and primary screen source to Chromium WASAPI loopback.
    // In the renderer, video tracks are disabled without stopping to preserve audio session.
    logDiag('SysAudioDiag:04-SourceSelection', 'Returning loopback audio and primary screen source to Chromium', {
      sourceId: screenSource.id,
      sourceName: screenSource.name,
    });
    callback({ video: screenSource, audio: 'loopback' });
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app.whenReady().then(async () => {
    await initServices();
    const win = createMainWindow();
    mainWindow = win;
    configurePermissions(win);
    registerIpc(
      win,
      service,
      settingsService,
      systemAudioGate,
      suggestionService,
      screenCaptureService,
      screenContextManager,
      diagnosticsService,
    );

    win.webContents.on('render-process-gone', (_e, details) => {
      logDiag('Process:RendererGone', 'Renderer process gone', {
        reason: details.reason,
        exitCode: details.exitCode,
      });
      diagnosticsService?.recordError('RENDERER', `Renderer process terminated: ${details.reason}`);
      systemAudioGate.disarm();
      suggestionService?.destroy();
      void service?.stop();
      screenContextManager.clear();
    });

    win.on('closed', () => {
      mainWindow = null;
    });
  });

  app.on('child-process-gone', (_e, details) => {
    logDiag('Process:ChildGone', 'Child process gone', {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      name: details.name,
    });
  });

  // Always release all audio, WebSocket, database and screen resources cleanly on shutdown.
  let isShuttingDown = false;
  app.on('before-quit', (event) => {
    if (isShuttingDown) return;
    event.preventDefault();
    isShuttingDown = true;

    logDiag('Lifecycle', 'Graceful shutdown initiated: releasing all resources...');
    systemAudioGate.disarm();
    suggestionService?.destroy();
    screenContextManager.clear();

    void Promise.resolve(service?.stop())
      .catch((err) => console.warn('[Main] Error stopping session on quit', err))
      .then(() => {
        try {
          repository?.flush?.();
          repository?.close?.();
        } catch (err) {
          console.warn('[Main] Error closing repository on quit', err);
        }
      })
      .finally(() => {
        logDiag('Lifecycle', 'Cleanup finished. Exiting application.');
        app.exit(0);
      });
  });
  app.on('window-all-closed', () => app.quit());
}
