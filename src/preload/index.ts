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
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    save: (settings) => ipcRenderer.invoke(IPC.settingsSave, settings),
  },
  systemAudio: {
    arm: () => ipcRenderer.invoke(IPC.systemAudioArm),
    disarm: () => ipcRenderer.invoke(IPC.systemAudioDisarm),
  },
  audio: {
    sendChunk: (source, buffer) => {
      ipcRenderer.send(IPC.audioChunk, source, buffer);
    },
  },
  gemini: {
    test: (question) => ipcRenderer.invoke(IPC.geminiTest, question),
  },
  ai: {
    ask: (question, options) => ipcRenderer.invoke(IPC.aiAsk, { question, options }),
  },
  screen: {
    getSources: () => ipcRenderer.invoke(IPC.screenGetSources),
    capture: (sourceId) => ipcRenderer.invoke(IPC.screenCapture, sourceId),
    confirm: (screenshotId) => ipcRenderer.invoke(IPC.screenConfirm, screenshotId),
    discard: (screenshotId) => ipcRenderer.invoke(IPC.screenDiscard, screenshotId),
    clearContext: () => ipcRenderer.invoke(IPC.screenClearContext),
    getContext: () => ipcRenderer.invoke(IPC.screenGetContext),
    analyze: (request) => ipcRenderer.invoke(IPC.screenAnalyze, request),
  },
  diagnostics: {
    get: () => ipcRenderer.invoke(IPC.diagnosticsGet),
    export: () => ipcRenderer.invoke(IPC.diagnosticsExport),
  },
  diag: {
    log: (category, message, data) => {
      ipcRenderer.send(IPC.diagLog, category, message, data);
    },
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
