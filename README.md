# GigaAgent

A Windows desktop copilot (Electron + React + TypeScript) for **mock interviews, meetings where recording and AI assistance are permitted, and study sessions**. It transcribes speech, drafts answers you can refine, and keeps everything in a local library.

> **3.0 status:** code complete and unit-tested, but not yet run on real Electron — follow RESUME.md first. Screenshots in `docs/screenshots/` are headless renders of the real UI with sample data.

**Principles**
- Recording is always visible to you: session bar, window title and taskbar.
- **Ghost Mode** uses the operating system's window capture-exclusion flag so this window is left out of screen captures made on this computer. It is a privacy control, not a way to be undetectable: it does not hide the app from Task Manager, monitoring/proctoring software or a camera. Use the app only where recording and AI assistance are allowed, and tell other participants.
- Data stays on this computer except what you send to Gemini / Deepgram with your own keys; each can be switched off in Settings → Privacy.

See CHANGELOG.md, MASTER_ARCHITECTURE.md, SECURITY_REPORT.md.

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

`npm i -D electron-builder` then `npm run package` → `release/`. Config: `electron-builder.yml` (per-user NSIS, user data kept on uninstall). Code signing and an icon are still required before distribution.

## Troubleshooting

- **Blank window in `npm run dev`**: check the terminal for a main-process error; the renderer is served from `ELECTRON_RENDERER_URL`.
- **`npm test` can't find tests**: use Node 22+ (glob support in `--test`).
