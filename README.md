# AI Meeting Assistant

A Windows desktop app (Electron + React + TypeScript) for **mock interviews, meetings where recording and AI assistance are permitted, and study sessions**. It will transcribe speech, summarise discussions and suggest responses.

**Design principles that are part of the product, not afterthoughts**

- Recording is always visible: a full-width banner at the top of the window and a `●` in the window title / taskbar while a session runs.
- The app has no hidden or stealth mode and no features aimed at evading meeting or exam monitoring. Use it only where recording and AI assistance are allowed, and tell other participants.
- Everything stays on your computer except what is sent to the Gemini API (from milestone 3).
- You can delete any session, or all history, at any time.

## Status

| # | Milestone | State |
|---|-----------|-------|
| 1 | Working desktop UI (start/stop, live transcript view, history, deletion) | **Done**. Uses a scripted *demo* transcript source, no audio |
| 2 | Microphone permission, capture, streaming transcription | Next |
| 3 | Gemini summaries and context-aware suggestions, API usage tracking | Planned |
| 4 | Document retrieval, screenshot analysis (OpenCV + vision model) | Planned |
| 5 | SQLite history, security review, electron-builder Windows installer | Planned |

## Requirements

- Windows 10/11 (development also works on macOS/Linux; packaging targets Windows)
- Node.js 22 LTS or newer, npm 10+

## Install and run

```bash
npm install
npm run dev        # starts Electron with hot reload
```

## Test and type-check

```bash
npm test           # unit tests (Node's built-in test runner via tsx)
npm run typecheck  # strict TypeScript for main/preload and renderer
npm run build      # production build into ./out
```

## Project structure

```
src/
  shared/            Types and pure logic used by every process (no Electron/DOM imports)
    types.ts           domain types, Result<T>, session events
    ipc.ts             IPC channel names + the typed window.api contract
    transcript.ts      applySegment(): interim -> final merging
    validation.ts      validation of untrusted IPC input
    format.ts          clock / date formatting
  main/              Node/Electron main process
    index.ts           app lifecycle, permission lockdown, window title indicator
    window.ts          hardened BrowserWindow (sandbox, contextIsolation, no nodeIntegration)
    ipc.ts             IPC handlers: sender check, validation, error containment
    services/
      sessionService.ts        session state machine (idle > starting > active > stopping)
      transcriptSource.ts      interface every transcript source implements
      demoTranscriptSource.ts  milestone-1 scripted source (no audio)
      sessionRepository.ts     storage interface + in-memory implementation (SQLite in M5)
  preload/index.ts   contextBridge: exposes only window.api
  renderer/          React UI (no Node access, no secrets)
tests/               unit tests
```

## Security model

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The renderer only sees `window.api`.
- Every IPC handler checks that the caller is the app's own window, validates its input, and returns a typed `Result` (never a raw exception).
- All device permissions are **denied by default**; milestone 2 will allow microphone access for the app's own window only.
- Navigation away from the app and popups are blocked; only `https://` links open, in the user's browser.
- A strict Content-Security-Policy is injected into production builds.
- Secrets never enter renderer code. From milestone 3 the Gemini key will be entered in a settings screen and stored encrypted with Electron `safeStorage` (Windows DPAPI) in the main process. `.env*` files are git-ignored.

## Windows packaging

Added in milestone 5 (electron-builder, NSIS installer, `npm run package`). This README will document code-signing, the installer output and uninstall behaviour there.

## Troubleshooting

- **Blank window in `npm run dev`**: check the terminal for a main-process error; the renderer is served from `ELECTRON_RENDERER_URL`.
- **`npm test` can't find tests**: use Node 22+ (glob support in `--test`).
