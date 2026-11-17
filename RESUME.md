# Resume here
**State:** 3.0 code complete; verified only by unit tests, type-check with stand-in typings, and headless rendering of the real React UI against a mocked bridge. **Never yet launched in Electron.**

**Exact next action (Windows, in this folder):**
1. `npm install`
2. `npm run typecheck` — expect possible small type errors where real Electron/React typings are stricter than the stand-ins; fix those first.
3. `npm test` — expect 148 passing.
4. `npm run dev` — check: start/stop with Mic+System, level meters, pause, ask a question (streaming + Stop), format switch, Ghost toggle (verify with a screenshot tool), capture → confirm → ask, save/export/delete, Ctrl+E, global shortcuts.
5. Packaging (after approving electron-builder): `npm i -D electron-builder && npm run package`.

Outstanding work: IMPLEMENTATION_ROADMAP.md. Decisions: TECHNICAL_DECISIONS.md.
