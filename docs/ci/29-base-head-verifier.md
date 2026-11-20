## Base-head verifier

`pstack-verifier.yml` runs the change on the base commit and on the pull request head, then compares. A verdict says what the change did, not only that the head still works.

Journeys come from the feature map. The plan lane reads `.claude/skills/verify-qa/reference/feature-map` from the production checkout, never from the candidate, and picks the pages whose code the pull request touches: a changed flag definition, a flag key in a changed line, a named source or API path, a named component directory, or a distinctive file name. A test file never selects a page, and a flag-looking file name is not a flag key, because nearly every page names its own tests. At most six pages are planned, highest score first, so one plan stays inside the lane timeouts. A page whose plan cannot be read is logged and skipped; it does not throw away the pages that were read. Each matched page gives one `area:<page>` journey planned from that page's own text, so the same page on the same base always gives the same script. One `change:primary` journey is planned from the pull request, and a `[BUGFIX]` title plans `change:repro` instead: the repro must fail on base and pass on head. A change that matches no page keeps the change journey alone and is never worse than the previous behaviour.

Before the change journey is planned, the plan lane traces each changed library file through its importers, two hops at most, to the `src/pages` or `src/app` file that uses it, and names the feature page that mentions that file. The planner reads that trace, so a library change is never called a non-app change while an importer reaches a screen or an API route. The planner also reads the seeded fixtures: `{id}` is the active board, `{task}` is a task on it and `{archived}` is the archived board. It may plan setup actions as `api` calls, and a body value that is exactly one of those placeholders becomes a number, while the same placeholder inside a longer string stays text.

The base lane checks out `base.sha` as its candidate and uses the production checkout as its trusted root, the same root the head lane uses, so the base app boots with the dependencies that were just installed and the trusted scripts. A trusted root counts only when its `node_modules` holds an npm install; an empty directory installs the candidate's own dependencies inside the container instead of booting without them. Both lanes classify a journey the same way: unavailable when the preview did not start, failed with the first failing step or expect, otherwise ok. A lane whose steps passed is judged by the same model and prompt, so a model cannot invent a regression by faulting only one lane.

The plan lane restores `actions/cache` entries written by earlier runs on the same base commit, keyed `pstack-base-<base.sha>-<production sha>` with `restore-keys: pstack-base-<base.sha>-`. An entry carries the journey script and its base result, so a warm cache pays no model call and no base drive for that journey. Entries are reused only for the same base, the same production checkout, the same journey and the same script hash; anything else is a miss. The base job declares `cache-mode: write` because the cache save is blocked by default for a `workflow_run` trigger.

Verdicts:

- every journey passed on head and the base comparison ran: PASS.
- a head journey failed earlier than base did, or at the same step with a different failure, or the repro passed on base: FAIL.
- an unavailable base comparison: the run could not evaluate the change, so the status is error and the recheck drives it again; it is never a FAIL on the change itself.
- the same failure at the same step on base and head: the change is not the cause, so it is PASS+NOTES naming it. For a repro that fails the same way on both sides, the run could not evaluate the change, so the status is error.
- a bug fix whose repro cannot be built, or a change that reaches a screen but whose plan found no user path: the run could not evaluate the change, so the status is error, never FAIL on the change itself.
- some journey got further than base without passing: PASS+NOTES naming it.
- non-app files only: PASS+NOTES, no app path.

An identical diff is not an identity: a rebase onto a new base can bring production files the diff never shows, and `git patch-id --stable` ignores whitespace inside a value. Reuse is therefore anchored on the head tree, and the recheck re-runs a green head whose base has moved. That machinery is not in this change yet.
