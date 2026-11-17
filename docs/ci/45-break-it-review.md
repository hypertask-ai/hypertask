## Break-it review (HTPR-9408)

A `[BUGFIX]` pull request gets edge-case tests from a different model family than its `Author-Model` line. The job runs up to three of those tests on the pull request head, inside a sandbox with no network and no secrets. The reviewer script is the one on the base commit. The candidate install is `npm ci --ignore-scripts`, so a lifecycle script cannot run next to the key. It posts one comment and one `break-it` status: green when the fix held, red when a break found a hole, and red as unproven when the attempts did not run.

The job is report-only and never blocks a merge. It uses `OPENROUTER_EVAL_KEY` and `PSTACK_VERIFIER_ALT_MODEL`. A `deepseek` author needs the alternate model, because the default verifier is `deepseek/deepseek-v4.1-flash`. See [`.github/workflows/break-it-review.yml`](../.github/workflows/break-it-review.yml) and [`tests/break-it-review.test.cjs`](../tests/break-it-review.test.cjs).
