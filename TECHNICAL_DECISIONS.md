# Technical decisions
1. **Streaming contract = `TITLE:` line + Markdown** instead of a JSON envelope (JSON cannot be rendered progressively). Parser still accepts legacy JSON.
2. **One Gemini client** with injectable `fetch` (testable); fallback chain `gemini-flash-lite-latest → gemini-flash-latest → gemini-3.8-flash → gemini-2.5-flash`, user-overridable. Verified against ai.google.dev model docs on 2026-11-16.
3. **No fabricated fallbacks.** Local heuristic tips remain for no-key sessions but are labelled "Local tip · not AI-generated".
4. **Screenshots attach to manual questions only** unless the user opts in for automatic answers (privacy + tokens).
5. **Keys never written in plaintext**; without OS encryption they are memory-only.
6. **Mock interview directive reworded** to an interview-practice coach (matches product positioning); one test assertion updated accordingly.
7. **Ghost Mode default unchanged (on, as received)**; state and limits are now shown honestly. Consider defaulting to off for store distribution.
8. **Kept sql.js** (no native build step); library/search added to the same DB (migration v3). LIKE search with escaped wildcards (FTS5 is not in the default sql.js build).
9. **Native `<select>` and semantic controls** over custom menus: reliable with Narrator/NVDA and keyboard.
10. **rem + container queries** so text scale 90–200% reflows layouts.
11. **PDF export, region capture, restore-from-backup UI, STT provider switch** deliberately deferred (not verifiable here / higher risk).
