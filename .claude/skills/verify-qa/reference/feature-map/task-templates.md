# Board task templates

## Sub-features

- `board-task-templates` Board task templates.

## How to get to it (user POV)

Settings > Board > Task templates, or
`https://app.hypertask.ai/settings/board-task-templates`.
Use QA 985 on sandbox board 7049. The ticket flag is
`htpr-7472-task-templates`; verify its declared live mode first.

Live mode on 2026-11-20 was OFF. The settings section is then absent:
`/settings/board-task-templates` falls back to the board's Custom instructions
page. Read the mode before judging the section: `ht-verify flags show
htpr-7472-task-templates`. The route still answers, and only PATCH is gated
when the flag is off, so the API below is the drive while the flag is OFF.

## Driving it with agent-browser

1. Create a throwaway task with a title pattern and simple `<h2>` headings.
   Use Ctrl+K **Save task as template** (the palette row is worded that way),
   naming it Bug or A/B test. The command posts only `{taskId}`, so the template
   is named after the task title.
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

Worked on production, 2026-11-20, QA 985, board 7049, flag OFF:

```bash
ht-verify api GET "/api/task-templates?projectId=7049" --state "$QA_STATE"
# 200 {success:true, templates:[], labels:[], targetSection:{id:19410, section_title:"Doing"}}
ht-verify api POST /api/task-templates --data '{"taskId":<task>}' --confirm --state "$QA_STATE"
# 200 {success:true, template:{id:7, name:"<task title>"}}
ht-verify api PATCH /api/task-templates --data '{"templateId":7,"projectId":7049,"name":"renamed"}' --confirm --state "$QA_STATE"
# 403 {success:false, error:"Task template editing is turned off"} while the flag is OFF
ht-verify api DELETE /api/task-templates --data '{"templateId":7,"projectId":7049}' --confirm --state "$QA_STATE"   # 200 {success:true}
curl -s -w '\n%{http_code}\n' -X PATCH -H 'content-type: application/json' -d '{"id":"x"}' "https://app.hypertask.ai/api/task-templates?projectId=7049"
# 401 {success:false, error:"Unauthorized"}
ht-verify api GET "/api/task-templates?projectId=abc" --state "$QA_STATE"   # 400 projectId is required
```

The full on-state drive (settings editor, rename with reload, cancel an edit,
stale-save 409) is `verified-unreachable: htpr-7472-task-templates is OFF and
runners do not switch flags; tried /settings/board-task-templates (fell back to
Custom instructions) and the API above`.

## Gotchas

Cross-board edits must return 404. Anonymous edits return 401. Flag-off
PATCH returns 403 `Task template editing is turned off`; POST and DELETE are not
gated, so a flag-off run still creates and removes the fixture template. Stale
saves return 409 without replacing newer changes; the editor asks you to reload
before saving. Use `/api/task-templates` to inspect saved values, never
raw database access. Check the ordinary instruction editor still saves.

### What proof to collect

Record PATCH status and persisted values. Capture desktop 1440x900 and
phone 390x844 in Porcelain, Graphite, AMOLED and Dia, plus a main-path video.
Run the core inbox cycle.

### Cleanup

Delete only the task/template fixtures you made
through product surfaces. Never remove another runner's saved templates.
