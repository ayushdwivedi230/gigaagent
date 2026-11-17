# Project audit (as received → 3.0)

**Stack:** Electron 33 + electron-vite, React 18, TypeScript strict, sql.js. 13.6k lines, 110 tests (all passing once `electron`/`sql.js` resolve).

## Worked and was preserved
Mic / system / combined capture (AudioWorklet → 16 kHz PCM → IPC), Deepgram streaming with bounded reconnect, Gemini answers, intent/question pipeline, screenshot capture → confirm flow, SQLite history with corruption recovery, encrypted keys (safeStorage), sandboxed renderer + CSP, Ghost Mode (content protection).

## Defects found and fixed
| # | Area | Problem | Fix |
|---|------|---------|-----|
| 1 | Storage/privacy | sql.js `export()` reopens the DB and resets `PRAGMA foreign_keys`; after the first save, deleting a session left its transcript + answers in the file | Re-enable pragma after export, explicit child deletes, orphan cleanup on start |
| 2 | AI honesty | Failed manual questions returned a canned "answer" ("Live AI connection is syncing") | Removed; real error with cause |
| 3 | Ghost Mode | PowerShell P/Invoke spawned on every window `move`/`focus` event; can never work (API only accepts the owning process) | Removed; Electron `setContentProtection` only |
| 4 | Storage | Answers to manual questions hit an FK error (or became orphans); answer metadata (question, model, format) was not stored | Guard + migration v3 |
| 5 | Security | Markdown rendered with `dangerouslySetInnerHTML` on model output | Safe tokenizer → React nodes, https-only links |
| 6 | Audio | `start()` race: double start or stop-during-permission-prompt could leave an orphaned open mic stream | Generation-guarded start/stop |
| 7 | UI | Auto-answer toggle was cosmetic; History/Suggestions/RecordingBanner components existed but were never mounted | Wired to main; history/library UIs built |
| 8 | Security | `diag:log` IPC unauthenticated and unbounded; settings IPC stored unvalidated values; keys fell back to plaintext on disk; key prefix + transcript text logged | Validated, bounded, memory-only fallback, logs scrubbed |
| 9 | Config | `sttProvider: 'google'` selectable in types but not implemented (silently used Deepgram) | UI offers Deepgram / Local test mode only |
| 10 | Perf | Full DB export + write + backup copy on every final transcript segment; 250 ms clock re-render; continuous `move` handler | Debounced; 1 s tick; `moved` only |
| 11 | Docs | README said "no hidden mode" while Ghost Mode defaulted on | README + in-app text now describe it accurately |

## Still weak (see IMPLEMENTATION_ROADMAP.md)
Per-segment persistence rewrites the whole DB file (sql.js limitation); no speaker diarization (speaker = audio source); two near-duplicate Deepgram source classes.
