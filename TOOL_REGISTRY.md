# Tool registry
| Tool | Purpose | Source | Status | Notes |
|---|---|---|---|---|
| tsx / TypeScript / esbuild / Playwright | tests, type-check, UI bundling, headless screenshots | pre-installed in build sandbox | used | nothing installed |
| Stand-ins for `electron`, `sql.js`, React typings | let tests/type-check run offline | written for this session (outside the repo) | used | sql.js shim backed by node:sqlite, emulates the export() pragma reset |
| ai.google.dev (web search) | verify current Gemini model ids | official docs | used once | |
| **electron-builder** | Windows NSIS installer | npm (electron-userland) | **needs your approval** | `npm i -D electron-builder`; dev-only, no account/key; config already in `electron-builder.yml` |
| Context7, Figma, Chrome DevTools, GitHub, SonarQube MCPs | docs/design/review | — | not needed | no installs requested |
