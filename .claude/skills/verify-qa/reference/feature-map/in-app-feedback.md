# Feature map: in-app feedback

## How a customer reaches it

The feedback form posts to `POST /api/feedback`. `src/components/Modals/Feedback/sendFeedbackRequest.ts` sends the text, kind, notify flag, and page context. The route in `src/app/api/feedback/route.ts` creates a board 15 ticket in section 4389 with the `user-feedback` label. When `htpr-8887-feedback-brain-tag` is on, the same create also adds `brain-medium`.

## How to drive it

Sign in as the QA account. Post JSON to `https://app.hypertask.ai/api/feedback` with `text`, `kind`, and `notify: false`. Then find the new board 15 ticket by its title (`Bug: ` plus the first line) and read its labels. The response body is only `{ success: true }`, so the ticket read is the proof. The flag ships at `defaultMode: EVERYONE`, so flag off is UNREACHABLE in the declared mode: every account sees the brain tag. An authorized agent can prove the off path only during an Owner + QA hold with the flag Off; runners never switch a flag Off.

## What usually breaks

- The new ticket has `user-feedback` and no `brain-medium` while the flag is on.
- `brain-medium` appears while the flag is off.
- Every post assigns every accepted human member of board 15, whether `notify` is true or false; `notify` only adds a Notify marker to the description. Expect the inbox assignment and archive the fixture ticket.

## What proof to collect

The POST status, the new ticket id and its label names, a screenshot of that ticket, and the signed-in `/my-tasks` doctor shot. Desktop 1440x900 is enough. No layout change.

## Cleanup

Archive the fixture ticket through the product after the label check. Do not delete it.
