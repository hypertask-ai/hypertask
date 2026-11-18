## Break-it review (HTPR-9408)

A `[BUGFIX]` pull request gets up to three edge-case tests from another model family than its `Author-Model` line, run by the base-commit script inside a sandbox with no network and no secrets after a `npm ci --ignore-scripts` install, then one comment and one `break-it` status. Each test file stays under 1200 characters and the whole model answer under 3500, because a longer answer is cut off at the model's 1200-token cap and the review cannot run.

The answer is read as JSON whether the model fences it, wraps it in prose, or does both: the parser walks the reply for balanced JSON objects and takes the first one that carries a `tests` array, so a closing brace in the surrounding sentence no longer breaks the review. If no answer can be read, the script asks the model once more and prints why the first one failed; after the second failure it reports the reason. A `[BUGFIX]` pull request therefore costs at most two model requests, and the retry only happens on a parse failure, never on an HTTP error.

The job fails its own step when the review could not run or a break attempt found a hole, and prints the reason in the run log as well as in the comment and the status. `break-it` is not one of the required checks: per pstack's shipping playbook the one verdict on a bug fix comes from the independent verifier, so this result is that verifier's edge-case input rather than a second gate.

It uses `OPENROUTER_EVAL_KEY` and `PSTACK_VERIFIER_ALT_MODEL`, which a `deepseek` author needs because the default verifier is `deepseek/deepseek-v4.1-flash`. See [`.github/workflows/break-it-review.yml`](../.github/workflows/break-it-review.yml).
