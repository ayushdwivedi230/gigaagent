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
import { initDiagnosticsLogger, logDiag } from './services/diagnosticsLogger';
import type { SessionSnapshot } from '@shared/types';

let mainWindow: BrowserWindow | null = null;
let settingsService: SettingsService;
let repository: SessionRepository;
let service: SessionService;
let suggestionService: SuggestionService;
const systemAudioGate = new SystemAudioGate();

async function initServices(): Promise<void> {
  const userDataDir = app.getPath('userData');
  initDiagnosticsLogger(userDataDir);
  logDiag('Lifecycle', 'Initializing services in main process', { userDataDir });
  const settingsPath = path.join(userDataDir, 'settings.json');
  settingsService = new SettingsService(settingsPath, safeStorage);

  const dbPath = path.join(userDataDir, 'sessions.db');
  try {
    repository = await SqliteSessionRepository.create({ filePath: dbPath });
  } catch (err) {
    console.error('[Main] Failed to initialize SQLite repository, falling back to in-memory', err);
    repository = new InMemorySessionRepository();
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
    onSuggestion: (suggestion) => {
      service.emitEvent({ type: 'suggestion', suggestion });
    },
  });

  service.subscribe((event) => {
    if (event.type === 'status') {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setTitle(titleFor(event.snapshot));
      }
      suggestionService.setSession(
        event.snapshot.activeSession?.id ?? null,
        event.snapshot.activeSession?.mode ?? 'mock-interview',
      );
    } else if (event.type === 'segment') {
      suggestionService.handleSegment(event.segment);
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
    registerIpc(win, service, settingsService, systemAudioGate, suggestionService);

    win.on('closed', () => {
      mainWindow = null;
    });
  });

  // Always release the audio source before the process goes away.
  app.on('before-quit', () => {
    systemAudioGate.disarm();
    suggestionService?.destroy();
    void service?.stop();
    repository?.close?.();
  });
  app.on('window-all-closed', () => app.quit());
}
