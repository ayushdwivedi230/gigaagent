# Architecture

```
src/shared     pure TS, no Node/DOM: types, ipc contract, validation, settings (defaults+sanitiser),
               markdown tokenizer, speaking-time, export builder, modeTools, entitlements
src/main       index (lifecycle, permissions, shortcuts) · window (modes, bounds) · ipc (validated handlers)
  services/    geminiClient · suggestionService · intelligence/* (orchestrator, prompts, parser)
               sessionService · sqliteSessionRepository (sessions + library + search) · settingsService
               windowInvisibilityService (Ghost Mode) · screenCapture/Context · diagnostics
src/preload    contextBridge → window.api (only surface the renderer has)
src/renderer   App (compact | workspace) · state/useAssistant · components/* · styles.css (design system)
```

**Rules:** secrets and network calls live only in main; the renderer is sandboxed and receives masked settings. Every IPC handler checks sender + frame, validates input, returns `Result<T>`. `shared/` is reusable as-is by a future web/mobile client or backend.

**AI flow:** ask → `SuggestionService` (privacy gates, prefs, profile) → `ResponseOrchestrator` (intent, prompt, quality retry, cancel) → `GeminiClient` (SSE stream, model fallback, timeouts) → throttled `answer-delta` events → final `SuggestionItem`.

**Ghost Mode:** state machine `off | applying | active | unsupported | error` over Electron `setContentProtection` (Windows `WDA_EXCLUDEFROMCAPTURE`, macOS `NSWindowSharingNone`). Nothing else: no process hiding, no hooks.

## Commercial architecture (prepared, not built)
- `shared/entitlements.ts`: `EntitlementProvider` interface; shipped `LocalEntitlementProvider` grants all local features. **Client-side checks are not licensing.**
- Needs a trusted backend: accounts/auth, signed short-lived entitlement tokens, server-side gating of paid resources (hosted AI proxy, sync), usage metering, update feed. Local features must keep working offline.
- Packaging: `electron-builder.yml` (NSIS, per-user, data kept on uninstall). Before selling: code-signing certificate, app icon, auto-update (electron-updater + signed feed), privacy policy, EULA.
- Telemetry: none exists. If added it must be opt-in and disclosed.
