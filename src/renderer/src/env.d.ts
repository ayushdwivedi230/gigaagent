/// <reference types="vite/client" />
import type { MeetingAssistantApi } from '@shared/ipc';

declare global {
  interface Window {
    /** Injected by the preload script via contextBridge. */
    api: MeetingAssistantApi;
  }
}

export {};
