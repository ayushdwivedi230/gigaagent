# Roadmap (outstanding work, in priority order)
1. **Verify on Windows** (see RESUME.md) — nothing below matters until this passes.
2. Region-select screenshot capture; previous-context gallery.
3. PDF export (hidden window + `printToPDF`); restore-from-backup flow with validation.
4. Persistence: write-ahead/append strategy or `better-sqlite3` to stop whole-file rewrites on long sessions.
5. Merge the two Deepgram source classes; surface STT connection state (connecting/reconnecting) in the session bar.
6. Mock-interview session runner (question → answer → evaluation loop) and practice-history view built on existing tools.
7. Packaging: icon, code signing, auto-update; then accounts/entitlements backend.
8. Real screen-reader pass with NVDA + Narrator; axe audit in Electron.
