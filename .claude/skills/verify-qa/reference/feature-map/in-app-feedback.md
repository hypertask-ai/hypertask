# Feature map: in-app feedback

## Sub-features

- `feature-map-in-app-feedback` Feature map: in-app feedback.
- `htpr-8887-feedback-brain-tag` New feedback tickets also get `brain-medium`.

## How to get to it (user POV)

The feedback form posts to `POST /api/feedback`.
`src/components/Modals/Feedback/sendFeedbackRequest.ts` sends the text, kind,
notify flag, and page context. The route in `src/app/api/feedback/route.ts`
creates a board 15 ticket in section 4389 with the `user-feedback` label. When
`htpr-8887-feedback-brain-tag` is on, the same create also adds `brain-medium`.

## Driving it with agent-browser

Sign in as the QA account. Post JSON to `https://app.hypertask.ai/api/feedback`
with `text`, `kind`, and `notify: false`. Then find the new board 15 ticket by
its title (`Bug: ` plus the first line) and read its labels. The response body is
only `{ success: true }`, so the ticket read is the proof.

```bash
ht-verify api POST /api/feedback --state ~/.config/hypertask-videos/storageState-qa.json \
  --data '{"text":"<unique line>","kind":"Bug","notify":false,"pathname":"/settings/accounts","pageTitle":"Accounts"}' --confirm
# then, with a QA agent token, find it and read the labels:
#   hypertask_tasks {"action":"list","input":{"project_id":15,"search":"<unique line>"}}
#   hypertask_tasks {"action":"get","input":{"ticket_number":"HTPR-N"},"response_format":"detailed"}
ht-verify api POST '/api/tasks/(un)archive' --data '{"taskId":<id>,"status":"Archive"}' --confirm
```

`kind` must be one of `Bug`, `Idea`, `Question`, `Praise`; anything else is 400
`Invalid feedback kind`. `notify` defaults to true when omitted, and the
description then gains `<p><strong>Notify:</strong> yes</p>`. The title is
`<kind>: <first line>`, cut at 80 characters. A `screenshotUrl` is validated
with a HEAD request, so leave it out rather than passing a placeholder.

The flag ships at `defaultMode: EVERYONE`, so flag off is UNREACHABLE in the
declared mode: every account sees the brain tag. An authorized agent can prove
the off path only during an Owner + QA hold with the flag Off; runners never
switch a flag Off.

## Gotchas

- The new ticket has `user-feedback` and no `brain-medium` while the flag is on.
- `brain-medium` appears while the flag is off.
- Every post assigns every accepted human member of board 15, whether `notify`
  is true or false; `notify` only adds a Notify marker to the description.
  Expect the inbox assignment and archive the fixture ticket.
- The check notifies real board 15 members (user 6 among them). Post once, read
  the labels, archive the same ticket in the same run.
- On 2026-11-20 user 985 got `user-feedback` and `brain-medium` on HTPR-9518 in
  section 4389 (Backlog), matching the flag-on expectation.

### What proof to collect

The POST status, the new ticket id and its label names, a screenshot of that
ticket, and the signed-in `/my-tasks` doctor shot. Desktop 1440x900 is enough. No
layout change.

### Cleanup

Archive the fixture ticket through the product after the label check. Do not
delete it.
