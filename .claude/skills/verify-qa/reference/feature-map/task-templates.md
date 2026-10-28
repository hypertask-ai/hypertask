# Board task templates

## How a customer reaches it

Settings > Board > Task templates, or
`https://app.hypertask.ai/settings/board-task-templates`.
Use QA 985 on sandbox board 7049. The ticket flag is
`htpr-7472-task-templates`; verify its declared live mode first.

## How to drive it

1. Create a throwaway task with a title pattern and simple `<h2>` headings.
   Use Ctrl+K **Save as template**, naming it Bug or A/B test.
2. Open Task templates. Verify the board's template name and headings.
3. Edit its name, title pattern and description structure. Save and reload.
   Cancel a second edit; reload and verify the saved content is unchanged.
4. Rich descriptions are read-only in this plain-text editor. Rename one
   and confirm its existing formatting survives unchanged.
5. Use Ctrl+J on that board: request an A/B test with five finished headlines.
   Supply concrete board facts; verify exactly five ideas, template headings
   and title pattern, estimated ICE parts, and no unfinished placeholders.
   Save the draft and reload the task to prove persistence.
6. Repeat an ordinary edit request: it must not invent marketing copy.
   Write with AI keeps its existing behavior. With the flag off, the new
   settings section is absent and existing authoring stays unchanged.

## What usually breaks

Cross-board edits must return 404. Anonymous edits return 401. Flag-off
PATCH returns 403. Stale saves return 409 without replacing newer changes;
the editor asks you to reload before saving. Use `/api/task-templates` to inspect saved values, never
raw database access. Check the ordinary instruction editor still saves.

## What proof to collect

Record PATCH status and persisted values. Capture desktop 1440x900 and
phone 390x844 in Porcelain, Graphite, AMOLED and Dia, plus a main-path video.
Run the core inbox cycle.

## Cleanup

Delete only the task/template fixtures you made
through product surfaces. Never remove another runner's saved templates.
