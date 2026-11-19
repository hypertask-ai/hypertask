## Base-head verifier

`pstack-verifier.yml` runs the change on the base commit and on the pull request head, then compares. A verdict says what the change did, not only that the head still works.

Journeys come from the feature map. The plan lane reads `.claude/skills/verify-qa/reference/feature-map` from the production checkout, never from the candidate, and picks the pages whose code the pull request touches: a changed flag definition, a flag key in the diff, a named source or API path, a named component directory, or a distinctive file name. At most six pages are planned, highest score first, so one plan stays inside the lane timeouts. A page whose plan cannot be read is logged and skipped; it does not throw away the pages that were read. Each matched page gives one `area:<page>` journey planned from that page's own text, so the same page on the same base always gives the same script. One `change:primary` journey is planned from the pull request, and a `[BUGFIX]` title plans `change:repro` instead: the repro must fail on base and pass on head. A change that matches no page keeps the change journey alone and is never worse than the previous behaviour.

The base lane checks out `base.sha` and uses that checkout as both candidate and trusted root, so its seed, migrations, auth and harness all come from the base commit. The head lane runs the same trusted root with the head only as candidate. Both lanes classify a journey the same way: unavailable when the preview did not start, failed with the first failing step or expect, otherwise ok. A lane whose steps passed is judged by the same model and prompt, so a model cannot invent a regression by faulting only one lane.

The plan lane restores `actions/cache` entries written by earlier runs on the same base commit, keyed `pstack-base-<base.sha>-<production sha>` with `restore-keys: pstack-base-<base.sha>-`. An entry carries the journey script and its base result, so a warm cache pays no model call and no base drive for that journey. Entries are reused only for the same base, the same production checkout, the same journey and the same script hash; anything else is a miss. The base job declares `cache-mode: write` because the cache save is blocked by default for a `workflow_run` trigger.

Verdicts:

- every journey passed on head and the base comparison ran: PASS.
- a head journey failed at or before the base's first failure, or the repro passed on base: FAIL.
- an unavailable base comparison: FAIL, and the note says the base lane is what failed.
- some journey got further than base without passing: PASS+NOTES naming it.
- non-app files only: PASS+NOTES, no app path.

An identical diff is not an identity: a rebase onto a new base can bring production files the diff never shows, and `git patch-id --stable` ignores whitespace inside a value. Reuse is therefore anchored on the head tree, and the recheck re-runs a green head whose base has moved. That machinery is not in this change yet.
