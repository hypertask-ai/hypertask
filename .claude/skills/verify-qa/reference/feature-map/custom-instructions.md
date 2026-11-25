# Board custom instructions

## Sub-features

- `board-custom-instructions` Board custom instructions.

## How to get to it (user POV)

Settings > Board > Custom instructions, or
`https://app.hypertask.ai/settings/board-ai`.
The page writes to the board currently selected in the board picker, which
comes from the current-project store or the `previousBoard` cookie, not from
the URL. Open board 7049 first, then Settings, and read the picker label (`QA
Sandbox`) before saving. QA 985 on sandbox board 7049.

## Driving it with agent-browser

Verified on production 2026-11-20, board 7049:

1. `ht-verify open '/project?id=7049&surface=board'`, wait for the board, then
   `ht-verify open /settings/board-ai`; the picker must read `QA Sandbox`.
2. Baseline: `ht-verify api GET
   '/api/ai/project/customInstruction?projectId=7049'`. A `null`
   `customInstruction` means empty; compare against `""`, not `null`.
3. Read the textarea (`textarea` on the page) before editing; it must equal the
   baseline.
4. Fill `QA 985 probe\nKeep replies short.` and click `Save instructions`.
   Require the toast `Custom instructions updated` and the textarea keeps the
   two lines.
5. Reload Settings: the same two lines. Leave to the board and reopen Settings:
   the same two lines.
6. Edit to `draft only`, leave and reopen without saving: only the saved two
   lines remain.
7. Restore the baseline (empty string when the baseline was `""`) through the
   same Save, then require the GET body equals the baseline exactly.
8. The Save POST is `/api/ai/project/customInstruction`. A missing projectId
   answers 101 and an invisible board answers 404; the UI only treats 200 as
   success. An empty string is a valid save, not an error.
9. The command-palette entry is `AICustomInstruction`; it is not a task command
   menu item.
10. Capture desktop and phone in Light, AMOLED and Graphite 2; compare controls
    and layout against production before the fix. Run the core inbox cycle
    after deployment.

### Hands-free drive on production

```bash
node .claude/skills/verify-qa/scripts/feature-map-drive.mjs {slug} --dir /tmp/feature-map-drive
```

Prints `PASS` or `FAIL` per step, writes `result.json` and screenshots into `--dir`, and ends with
`{slug} ok`. It refuses any base except `https://app.hypertask.ai`, uses the `qa-login` identities,
creates only fixtures its own cleanup removes, and never prints a cookie, token or email address.

## Gotchas

Initializing from a project store before query hydration shows a blank panel,
not an empty editor, until the query and store agree (`BoardAiSection.tsx`). A
stale query after saving can restore the previous text when reopening. The
saved-data fix has no flag and changes no prompts or models. A late hydration
no longer clobbers a dirty draft; an empty save persists as empty.

### What proof to collect

Record response status, saved text and textarea values after reload/reopen.
Capture desktop and phone in Light, AMOLED and Graphite 2. Compare with
production before the fix: controls and layout must not change.
Run the core inbox cycle after deployment.

### Cleanup

Restore the sandbox's previous instructions through the same save action.
Never replace another board's instructions. Delete only this run's fixtures.
