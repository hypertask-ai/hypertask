# Task writer and chip evaluation

## Sub-features

- `short-task-writer-rollout` Short task-writer rollout.
- `writer-board-format` With `htpr-7471-writer-board-format` on, Task Writer keeps the board's recurring section order and title pattern, keeps each section short, and fills only that board's custom fields. A Ctrl+J save checks those values against the board before it writes them.
- `writer-old-structure` With `htpr-7500-writer-old-structure` on, Task Writer keeps the board's full section list, a source-grounded Control, and ICE scores that each have a short reason, while still aiming for about 180 to 240 visible words. Off uses the shorter web style unless board format or task templates are also on.
- `plain-language-ticket-template` With `htpr-7933-plain-language-ticket-template` on, an agent create on board 15 or board 4060 is refused until the description opens with the five labels in `docs/ticket-template.md`. A move into the Valentin Review column on those boards needs that same block in the description or in the newest agent comment.
- `task-create-ai-step-timing` With `htpr-8095-task-create-ai-step-timing` on, a Ctrl+J New Task save records how long the writer step took, and the New Task window records how long the title step took, beside the save and screen-update times. Off leaves those two measurements empty. The saved ticket and the screen stay the same.
- `writing-house-rules` With `htpr-8798-writing-house-rules` on, an agent create is refused for a dashed code name, a plain quote of Valentin, a Question in the wrong shape, or a new description missing Problem, Fix, Done when, Risk, or Decision. A human write is not checked.
- `shared-ticket-writing` With `htpr-8905-shared-ticket-writing` on, an agent that saves a new ticket through the app create route runs the same writing check the agent tools use. Off lets that app create save text the agent tools still refuse. A human create is not checked.
- `writer-urgency` With `htpr-9009-writer-urgency` on, Task Writer sets priority to Urgent when the note has an urgency word and the three words before it do not negate it. Off leaves today's priority behavior.
- `task-writer-brain-tag` With `htpr-9010-task-writer-brain-tag` on, and only when the writer is also allowed to set project labels, Task Writer picks exactly one brain label on a board that already has them. The user does not name the tag. Off leaves today's labels.
- `task-writer-memory` With `htpr-9010-task-writer-memory` on, accepting a Task Writer draft on the New Task window or in the ticket's AI writer records the raw note, capped at 2,000 characters, and the save posts which of those fields changed. Off sends nothing. The screen does not change.
- `jev-duplicate-hint` With `htpr-9046-jev-duplicate-hint` on, Task Writer asks Jev whether each similar ticket is the same work. When Jev is at least 0.9 sure, the first sentence of the description is "Looks like TICKET may cover the same work." Off adds no sentence and spends nothing on Jev.

## How to get to it (user POV)

GitHub Actions: Task writer live eval. No app UI changes.
Sources: `scripts/task-writer-eval.cjs`, `.github/workflows/task-writer-eval.yml`.

Ctrl+J (Cmd+J on a Mac) opens New Task from a board. The writer draft, priority, and duplicate sentence show on the saved ticket. The New Task window and the AI writer on a ticket are the screens that record a writer note for board memory. Timing shows up on the `app_task_create_latency` event as `ai_task_writer_ms` and `ai_title_ms`, not as new copy on the ticket.

Agent creates that must follow the plain-language block or the house writing rules go through the agent task tools, including POST /api/mcp/tasks/create. An agent save from the app uses POST /api/tasks/createGlobally. Boards 15 and 4060 are the internal boards for the plain-language block. The Valentin Review column is a section on those boards, not a separate page.

## Driving it with agent-browser

1. Confirm the merge's Production deployment succeeded.
2. Dispatch Task writer live eval on `production`.
3. Require QA identity 985 and all 22 cases.
4. Read score and cleanup artifacts, not only the job badge.
5. Replay the committed baseline with `node scripts/task-writer-eval.cjs --verify-baseline`.

Board format, old structure, urgency, brain tag, and the duplicate sentence:

6. Open a board you can write on and press Ctrl+J.
7. Send a short note and open the saved ticket.
8. For board format, use a board whose tickets share a title pattern and custom fields. The new ticket keeps that order. A custom field value that is not on the board is dropped. See `src/app/api/ai/_lib/taskWriterRun.ts`.
9. For old structure, confirm the draft still has the board's sections. When the board uses ICE, each of Impact, Confidence, and Ease has a 1 to 10 score, a short reason, and a total out of 30.
10. For urgency, put "urgent" in the note with no negating word in the three words before it. Priority becomes Urgent (index 1). "not urgent" does not. The words are urgent, asap, today, right now, immediately, blocker, and production down, plus the same ideas in German, French, Spanish, Dutch, Portuguese, and Italian. See `src/lib/ai/taskWriterUrgency.ts`.
11. For the brain tag, the board must already have at least one of brain-light, brain-medium, brain-hard, or brain-extra-hard, and project labels from the writer must be allowed. The ticket gets exactly one. If the model picks none, the save keeps brain-medium when that label exists. See `src/lib/ai/taskWriterBrainLabels.ts`.
12. For the duplicate sentence, the board needs a similar open ticket and a team key that is not a customer's own key, unless the team is an internal comp team. When Jev's confidence is 0.9 or higher, the first sentence uses that ticket's number. Otherwise there is no warning. See `src/lib/ai/jevDuplicateHint.ts`.

Plain language and house writing rules:

13. As an agent, create a ticket on board 15 or 4060 without opening on "What's wrong or wanted:". POST /api/mcp/tasks/create returns 400 and names the missing labels. The five labels are What's wrong or wanted, Who it affects, Recommended course and why, What Valentin must decide, and How to undo.
14. Add those five labels, then move the ticket to Valentin Review. The move is refused when neither the description nor the newest agent comment has the block. See `src/lib/tickets/plainLanguageTicket.mjs`.
15. As an agent, create a ticket whose description has no Problem, Fix, Done when, Risk, or Decision line. The create names the missing part. A dashed code name and a line that quotes Valentin in quote marks are also refused. A Question must start with What this is, use at most three points, then put Question, My recommendation, Why, Yes, and No on their own lines. A human create of the same text is saved. See `src/lib/agents/writing.ts`.
16. As an agent, save a new ticket with POST /api/tasks/createGlobally using text the agent tools already refuse. The flag on returns 400. The flag off allows that save. A human save is allowed either way.

Timing and board memory:

17. Save a Ctrl+J New Task. On `app_task_create_latency`, `ai_task_writer_ms` is set when the writer step ran. On the New Task window, `ai_title_ms` is set when a title was generated. Off leaves the measurement that did not run null. See `src/lib/analytics/productPerformance.ts`.
18. On the New Task window, accept a Task Writer draft that changes the title or priority, then save. The browser POSTs `task_writer_field_diff` to POST /api/ai/project/memory. The note is at most 2,000 characters. Changed fields are title, priority, size, labels, status, due date, and start date. If board memory is off, the response has enabled false and an empty learned list. A note with an email, a phone number, a street address, or a secret is not learned. Off does not post.

## Gotchas

- Raw writer markers are saved instead of parsed descriptions.
- A chip requests a section already present.
- Empty chip fallbacks masquerade as model success.
- Missing cases, transport errors or cleanup failures appear green.
- QA credentials reach candidate code or artifact uploads.
- A flag lookup failure still applies house writing rules and shared ticket writing.
- Board format loads at most 50 custom fields, ordered by ranking.
- Jev adds no sentence when search fails, the team has no key, the team pays with its own key and is not an internal comp team, or confidence is under 0.9.
- Urgency ignores a match when a negating word such as not, no, or never sits in the three words before it.
- The brain tag does nothing on a board with no brain labels, and it does not run when the writer cannot set project labels.
- Board memory posts only when a recorded field changed. An unchanged draft sends nothing. The Ctrl+J compose writer does not send this signal. The New Task window and the ticket AI writer do.
- Plain-language refusal applies only on boards 15 and 4060.
- Step timing does not change the saved ticket, its copy, or the save order.

### What proof to collect

Save the successful production workflow run, its exact head SHA, scores and
pending-ID report. Known baseline violations are measured debt, not healthy text.
The long non-A/B control must fail; finished synthetic A/B controls must pass.
Synthetic cases contain no customer text. Historical pair provenance follows
https://app.hypertask.ai/detail/project-15/7976#comment-314535.

### Short task-writer rollout

Flag `htpr-7977-short-task-writer` defaults to Everyone. QA account 985 sees it.
Ordinary drafts stay under 240 visible words and skip experiment headings.
A/B sections appear only when the ticket is an A/B test and board instructions
or a matching template request that layout. Flag off keeps the previous prompt.

### Board label pilot (Jev)

Offline: no app change, no flag. `scripts/task-writer-label-eval.cjs` compares Jev's
one-question-per-label picks with today's writer label decision on 200 past board 15
tickets. Re-run with a capped OpenRouter key and an Anthropic key, or check the committed
numbers with `--check-baseline`. First run, 2026-11-10: Jev loses on right labels and
wins on wrong ones only when asked about labels a writer sets, so it replaces nothing.
See `tests/fixtures/task-writer-label-eval/report.md` and HTPR-9047.

### Cleanup

Only run-created QA Sandbox 7049 tickets are soft-deleted and read back.
A failed cleanup leaves IDs in the status artifact for recovery.

### Brain tag eval (HTPR-9044)

`scripts/brain-tag-eval.cjs` compares Jev against Haiku on 200 board 15 tickets
that already carry a brain label, and scores exact match, the confident subset,
latency and cost. It is offline: no workflow, no app behaviour, no production
data written. `node scripts/brain-tag-eval.cjs --replay=<scores.json>` rebuilds
the report from a saved run. Method and the first result are in
[docs/brain-tag-eval.md](../../../../../docs/brain-tag-eval.md).
