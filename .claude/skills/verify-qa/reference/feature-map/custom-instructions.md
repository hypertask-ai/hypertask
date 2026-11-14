# Board custom instructions

## Sub-features

- `board-custom-instructions` Board custom instructions.

## How to get to it (user POV)

Settings > Board > Custom instructions, or
`https://app.hypertask.ai/settings/board-ai`.
Use QA 985 on sandbox board 7049.

## Driving it with agent-browser

1. Compare the textarea with
   `GET /api/ai/project/customInstruction?projectId=7049`.
2. Save non-empty multiline instructions. Require a successful POST and the
   exact saved value from GET. Reload Settings and verify the same text.
3. Leave and reopen Settings without reloading. Verify the saved text, then
   edit without saving and reopen: only the saved text should remain.
4. Open Custom instructions from a task's command menu. Verify the same board
   and saved text. Do not invoke paid AI generation to check persistence.
5. Check an empty save, a rejected save, and loading existing instructions
   before the current-project store has hydrated. A failed save keeps the
   draft, shows an error and does not replace the last successful value.

## Gotchas

Initializing from a project store before query hydration shows an empty
editor despite a successful GET. A stale query after saving can restore the
previous text when reopening. This saved-data fix has no flag and changes
no prompts or models.

### What proof to collect

Record response status, saved text and textarea values after reload/reopen.
Capture desktop and phone in Light, AMOLED and Graphite 2. Compare with
production before the fix: controls and layout must not change.
Run the core inbox cycle after deployment.

### Cleanup

Restore the sandbox's previous instructions through the same save action.
Never replace another board's instructions. Delete only this run's fixtures.
