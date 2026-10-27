import { app, session as electronSession } from 'electron';
import type { BrowserWindow } from 'electron';
import { registerIpc } from './ipc';
import { APP_NAME, createMainWindow } from './window';
import { DemoTranscriptSource } from './services/demoTranscriptSource';
import { InMemorySessionRepository } from './services/sessionRepository';
import { SessionService } from './services/sessionService';
import type { SessionSnapshot } from '@shared/types';

const service = new SessionService({
  repository: new InMemorySessionRepository(),
  // Milestone 2 replaces this with a microphone-backed source.
  createSource: () => new DemoTranscriptSource(),
});

let mainWindow: BrowserWindow | null = null;

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

/** Deny every permission by default. Milestone 2 will allow microphone access for our own window only. */
function lockDownPermissions(): void {
  const ses = electronSession.defaultSession;
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
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
    lockDownPermissions();
    const win = createMainWindow();
    mainWindow = win;
    registerIpc(win, service);
    service.subscribe((event) => {
      if (event.type === 'status' && !win.isDestroyed()) win.setTitle(titleFor(event.snapshot));
    });
    win.on('closed', () => {
      mainWindow = null;
    });
  });

  // Always release the audio source before the process goes away.
  app.on('before-quit', () => {
    void service.stop();
  });
  app.on('window-all-closed', () => app.quit());
}
