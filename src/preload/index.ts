import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { IPC } from '@shared/ipc';
import type { MeetingAssistantApi } from '@shared/ipc';
import type { SessionEvent } from '@shared/types';

// Expose a narrow, typed API. The renderer never sees ipcRenderer, Node, or any secret.
const api: MeetingAssistantApi = {
  session: {
    start: (request) => ipcRenderer.invoke(IPC.sessionStart, request),
    stop: () => ipcRenderer.invoke(IPC.sessionStop),
    snapshot: () => ipcRenderer.invoke(IPC.sessionSnapshot),
  },
  history: {
    list: () => ipcRenderer.invoke(IPC.historyList),
    get: (id) => ipcRenderer.invoke(IPC.historyGet, id),
    delete: (id) => ipcRenderer.invoke(IPC.historyDelete, id),
    clear: () => ipcRenderer.invoke(IPC.historyClear),
  },
  window: {
    minimize: () => { void ipcRenderer.invoke(IPC.windowMinimize); },
    close: () => { void ipcRenderer.invoke(IPC.windowClose); },
  },
  onEvent: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: SessionEvent): void => listener(payload);
    ipcRenderer.on(IPC.event, handler);
    return () => {
      ipcRenderer.removeListener(IPC.event, handler);
    };
  },
};

contextBridge.exposeInMainWorld('api', api);
