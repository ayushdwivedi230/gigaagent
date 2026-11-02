import { ipcMain } from 'electron';
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { IPC } from '@shared/ipc';
import { parseSessionId, parseStartRequest } from '@shared/validation';
import { err, ok } from '@shared/types';
import type { Result, UpdateSettingsRequest } from '@shared/types';
import type { SessionService } from './services/sessionService';
import type { SettingsService } from './services/settingsService';

/**
 * Registers request/response handlers and forwards service events to the window.
 * Every handler (1) rejects callers other than our own window, (2) validates input,
 * (3) never lets an exception escape as a raw error string.
 */
export function registerIpc(
  win: BrowserWindow,
  service: SessionService,
  settingsService: SettingsService,
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

  const onAudioChunk = (event: IpcMainEvent, chunk: unknown): void => {
    if (!trusted(event)) return;
    const activeSource = service.getActiveSource();
    if (!activeSource || !('pushAudioChunk' in activeSource)) return;
    const target = activeSource as { pushAudioChunk: (buf: ArrayBuffer) => void };

    if (chunk instanceof ArrayBuffer) {
      target.pushAudioChunk(chunk);
    } else if (ArrayBuffer.isView(chunk)) {
      const copy = new Uint8Array(chunk.byteLength);
      copy.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      target.pushAudioChunk(copy.buffer as ArrayBuffer);
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
