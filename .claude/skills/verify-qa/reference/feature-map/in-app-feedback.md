# Feature map: in-app feedback

## Sub-features

- `feature-map-in-app-feedback` Feature map: in-app feedback.

## How to get to it (user POV)

The feedback form posts to `POST /api/feedback`.
`src/components/Modals/Feedback/sendFeedbackRequest.ts` sends the text, kind,
notify flag, and page context. The route in `src/app/api/feedback/route.ts`
creates a board 15 ticket in section 4389 with the `user-feedback` label.

## Driving it with agent-browser

Sign in as the QA account. Post JSON to `https://app.hypertask.ai/api/feedback`
with `text`, `kind`, and `notify: false`. Then find the new board 15 ticket by
its title (`Bug: ` plus the first line) and read its labels. The response body is
only `{ success: true }`, so the ticket read is the proof.

## Gotchas

- The new ticket carries `user-feedback` and no other labels.
- Every post assigns every accepted human member of board 15, whether `notify`
  is true or false; `notify` only adds a Notify marker to the description.
  Expect the inbox assignment and archive the fixture ticket.

### What proof to collect

The POST status, the new ticket id and its label names, a screenshot of that
ticket, and the signed-in `/my-tasks` doctor shot. Desktop 1440x900 is enough. No
layout change.

### Cleanup

Archive the fixture ticket through the product after the label check. Do not
delete it.
