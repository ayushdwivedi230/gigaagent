import path from 'node:path';
import { app, safeStorage, session as electronSession } from 'electron';
import type { BrowserWindow } from 'electron';
import { registerIpc } from './ipc';
import { APP_NAME, createMainWindow } from './window';
import { DemoTranscriptSource } from './services/demoTranscriptSource';
import { MicrophoneTranscriptSource } from './services/microphoneTranscriptSource';
import { InMemorySessionRepository } from './services/sessionRepository';
import { SessionService } from './services/sessionService';
import { SettingsService } from './services/settingsService';
import { SuggestionService } from './services/suggestionService';
import type { SessionSnapshot } from '@shared/types';

let mainWindow: BrowserWindow | null = null;
let settingsService: SettingsService;
let service: SessionService;
let suggestionService: SuggestionService;

function initServices(): void {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  settingsService = new SettingsService(settingsPath, safeStorage);

  service = new SessionService({
    repository: new InMemorySessionRepository(),
    createSource: (_mode, sourceKind) => {
      if (sourceKind === 'microphone') {
        return new MicrophoneTranscriptSource({ settingsService });
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
    const label = session.source === 'microphone' ? 'Recording' : 'Demo session';
    return `● ${label} — ${APP_NAME}`;
  }
  return `${snapshot.status === 'starting' ? 'Starting' : 'Stopping'}… — ${APP_NAME}`;
}

/** Deny permissions by default, but permit audio-only microphone access for our authenticated window. */
function configurePermissions(win: BrowserWindow): void {
  const ses = electronSession.defaultSession;
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (webContents !== win.webContents) {
      return callback(false);
    }
    const mediaTypes = 'mediaTypes' in details && Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
    if (
      permission === 'media' &&
      mediaTypes.includes('audio') &&
      !mediaTypes.includes('video')
    ) {
      return callback(true);
    }
    callback(false);
  });

  ses.setPermissionCheckHandler((webContents, permission, _origin, details) => {
    if (webContents !== win.webContents) {
      return false;
    }
    const mediaType = 'mediaType' in details ? details.mediaType : undefined;
    if (permission === 'media' && mediaType === 'audio') {
      return true;
    }
    return false;
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

  void app.whenReady().then(() => {
    initServices();
    const win = createMainWindow();
    mainWindow = win;
    configurePermissions(win);
    registerIpc(win, service, settingsService);

    win.on('closed', () => {
      mainWindow = null;
    });
  });

  // Always release the audio source before the process goes away.
  app.on('before-quit', () => {
    suggestionService?.destroy();
    void service?.stop();
  });
  app.on('window-all-closed', () => app.quit());
}
