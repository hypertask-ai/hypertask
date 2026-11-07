# Feature map: in-app feedback

## How a customer reaches it

The feedback form posts to `POST /api/feedback`. `src/components/Modals/Feedback/sendFeedbackRequest.ts` sends the text, kind, notify flag, and page context. The route in `src/app/api/feedback/route.ts` creates a board 15 ticket in section 4389 with the `user-feedback` label. When `htpr-8887-feedback-brain-tag` is on, the same create also adds `brain-medium`.

## How to drive it

Sign in as the QA account. Post JSON to `https://app.hypertask.ai/api/feedback` with `text`, `kind`, and `notify: false`. Then find the new board 15 ticket by its title (`Bug: ` plus the first line) and read its labels. Flag off is the same post from an account that does not have the flag. The response body is only `{ success: true }`, so the ticket read is the proof.

## What usually breaks

- The new ticket has `user-feedback` and no `brain-medium` while the flag is on.
- `brain-medium` appears while the flag is off.
- `notify: true` assigns every accepted human member of board 15. Proof posts use `notify: false`.

## What proof to collect

The POST status, the new ticket id and its label names, a screenshot of that ticket, and the signed-in `/my-tasks` doctor shot. Desktop 1440x900 is enough. No layout change.

## Cleanup

Archive the fixture ticket through the product after the label check. Do not delete it.
