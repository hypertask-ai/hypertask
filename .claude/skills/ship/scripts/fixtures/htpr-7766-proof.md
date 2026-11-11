Feature map: .claude/skills/verify-qa/reference/feature-map/ai-chat.md
Doctor: sha c164a28dfcf6f06f5ef05b6fb9f414f880b3b49d deployment success (ship-check deployed ok, 2026-11-09 14:38 UTC); design-check doctor ok; /my-tasks signed in as user 985; htpr-7766-chat-shortcuts enabled (OWNER_AND_QA, unchanged)
Run: 2026-11-09-qa-run-14

## Cases
- PASS: /chat full screen to the docked sidebar chat: Ctrl+Shift+E moves the surface and the chat box holds the cursor, Porcelain, AMOLED and Graphite 2 -> results.json
- PASS: full screen to docked and back: the second press returns to full screen with the cursor in the chat box -> results.json
- PASS: docked to full screen and back: three presses in a row each move the surface and keep the cursor in the chat box -> results.json
- PASS: help sheet from all three surfaces: 16 actions listed, including Sidebar chat full screen or back -> keys.json
- PASS: full screen: board scope, model, mention, search, Ctrl+Q and pin work from the keyboard, hover titles name the key -> fullscreen-help.png
- PASS: docked sidebar: board scope, model, mention, search, Ctrl+Q and pin work from the keyboard, hover titles name the key -> sidebar-help.png
- PASS: floating window: board scope, model, mention, search, Ctrl+Q and pin work from the keyboard, hover titles name the key -> floating-help.png
- PASS: floating window: Ctrl+Shift+E opens the full-screen chat with the cursor in the chat box -> floating-to-fullscreen.png
- PASS: board keys j, k and / still act on the board while the docked chat and the floating chat are open -> keys.json
- PASS: doctor: QA 985 signed in on /my-tasks with the shortcut enabled -> doctor-my-tasks.png
- PASS: core inbox cycle after the deploy -> inbox-cycle/result.json

## Unreachable this run
- Ctrl+U attach file, Ctrl+Shift+D dictation and the session keys (Ctrl+Tab, Alt+Up, Alt+Down) were not re-pressed. This change does not touch them and the 2026-11-08 cross-QA covered them. Closest real check: the unchanged composer and session code plus CI tests on PR 3110 and 3111.
- The flag-off case is not run: only Valentin switches a flag Off, and the declared mode is Owner + QA.
