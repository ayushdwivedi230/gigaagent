import { ipcMain } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { IPC } from '@shared/ipc';
import { parseSessionId, parseStartRequest } from '@shared/validation';
import { err, ok } from '@shared/types';
import type { Result } from '@shared/types';
import type { SessionService } from './services/sessionService';

/**
 * Registers request/response handlers and forwards service events to the window.
 * Every handler (1) rejects callers other than our own window, (2) validates input,
 * (3) never lets an exception escape as a raw error string.
 */
export function registerIpc(win: BrowserWindow, service: SessionService): () => void {
  const trusted = (event: IpcMainInvokeEvent): boolean =>
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
    for (const channel of Object.values(IPC)) ipcMain.removeHandler(channel);
  };
}
