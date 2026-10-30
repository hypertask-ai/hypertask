## Task writer and chip quality baseline

The existing [AI evals workflow](../.github/workflows/ai-evals.yml) also replays
`tests/fixtures/task-writer-eval/recorded.json` through
`scripts/task-writer-eval.cjs --verify-baseline` on relevant PRs. This is recorded
behavior, not a live-model claim. The corpus has twenty historical first-version /
current-description pairs from our own board, plus two explicitly synthetic A/B
cases. First saved versions follow the [approved source decision](https://app.hypertask.ai/detail/project-15/7976#comment-314535);
they are not guaranteed raw keystrokes or proof of model authorship. The target
remains forty real pairs. No inne or IGSH text is included.

The separate [live workflow](../.github/workflows/task-writer-eval.yml) runs only
on production, scheduled at 04:17 UTC daily or manually. Its `task-writer-live` job
renews the existing QA 985 login using `QA_LOGIN_EMAIL` and `QA_LOGIN_PASSWORD`.
It calls the production task-writer route using current configured models, saves
each resulting draft as a temporary QA Sandbox ticket, and invokes the same
new-ticket chip route the UI uses. It never changes product prompts, model
settings, flags, customer tickets or other teams' chats. Each created fixture is
soft-deleted and read back before the next case; cleanup failures fail closed and
retain pending IDs. There are at most 22 writer and 22 chip calls per run, one
case at a time, with a twelve-minute start budget and twenty-minute job limit.

Writer scores measure word limits, required/forbidden headings and placeholders.
Chip scores detect requests for existing sections, exact normalized copies of the
current prompt's examples and edits to required writer text. Empty chip responses
are recorded as unproven, not successful generation. These deterministic checks do
not judge factual accuracy or semantic paraphrases. Known initial debt remains
visible in the committed baseline. Each live report includes separate writer and
chip deltas. Quality deltas are report-only: one stochastic trial is not evidence
of a stable regression. Transport failures and incomplete runs cannot become a baseline.
Only score reports and cleanup IDs upload as artifacts; cookies, auth traffic and
raw generated drafts do not. This is informational CI, not a new required check.

To refresh a baseline, run the live script with a QA storage-state file in
`QA_STATE` (or the existing renewal credentials) and `WRITER_EVAL_OUTPUT` pointing
outside the committed fixture folder. Review the full output, promote it to
`recorded.json`, then run `node scripts/task-writer-eval.cjs --save-baseline`.
The offline replay binds the complete corpus hash and recomputes every score.
