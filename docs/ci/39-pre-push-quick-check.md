## Pre-push quick check (HYCI-9)

`.githooks/pre-push` runs `scripts/quick-check.mjs` before every push from a
checkout, so a formatting, lint or type error is found in seconds instead of
after the `ci-checks` job. `scripts/install-git-hooks.mjs` copies the hook into
`$(git rev-parse --git-common-dir)/hooks/pre-push`, so one install covers every
worktree of the checkout. The `prepare` npm script runs the installer, so a
fresh clone gets the hook from `npm install` without a manual step. An existing
unrelated `pre-push` hook is left alone; an older copy of this repository's hook
carries a stable marker and is upgraded in place. The hook exits quietly when a
worktree predates `scripts/quick-check.mjs`, so an older branch never blocks on a
missing script.

The check is scoped to the change: files are the merge base of `HEAD` and
`origin/production`, the same base `scripts/lint-changed.mjs` uses. ESLint runs
with `--fix` on those files, and when it rewrites one the push stops so the fix
is committed. A checked file that differs from `HEAD` stops the push as well:
the tools read the working copy, so only a committed change is what the push
carries. A lint configuration change adds a read-only lint of a fixed sample of
eight untouched files spread across the tree, so a broken config still fails the
push in seconds; the full-repository lint is not part of the hook and stays in
CI. A `tsconfig` or dependency change runs the full type check. The type step
otherwise writes `.cache/tsc/quick-check.json`, a tsconfig that includes only the
changed TypeScript files and inherits the repository compiler options, and
type-checks that program. ESLint and tsc start together.

CI keeps the whole-program gates: the `ci-checks` job still runs the full ESLint
pass and `next typegen && tsc`. The hook only moves the same errors earlier, so
it never replaces a required check and adds no required context.

Every run is killed, with its process group, at 10 seconds per lint pass and per
type check, or at the longer limit when the full type check is asked for. A run
that overruns reruns once with a longer limit. A 60 second deadline for the whole
check caps every run and every retry, and never leaves a late run less than a
second, so the hook returns on any diff however busy the machine is;
`QUICK_CHECK_DEADLINE_MS`
changes that deadline, and the lint and type budgets take
`QUICK_CHECK_LINT_BUDGET_MS`, `QUICK_CHECK_TYPE_BUDGET_MS` and
`QUICK_CHECK_FULL_TYPE_BUDGET_MS` for tests. No environment variable switches the
check off.

When the deadline or a budget runs out, the check says so and the push is decided
by what finished. A run that was still going when its budget ran out and had
printed no error passes the push with `NOT FULLY LINTED` or `NOT FULLY TYPE
CHECKED`, the files, the budget that ran out and the command that reruns the
check, because the machine was too slow rather than the diff being wrong. Errors
the run printed before the kill still stop the push. A kill from outside the hook
(a SIGKILL or exit 137 from the machine) passes the same way and prints `NOT
TYPE CHECKED: <files>`. A missing tool stops the push: without `node_modules` the
hook asks for `npm install`.

The hook reads Git's ref updates and passes the push without checking when the
pushed commit is not the checked-out one, because the tools read the working
copy.

The hook's own tests, `tests/quick-check.test.cjs` and
`tests/install-git-hooks.test.cjs`, run in the `ci-tests` shards.
`tests/fixtures/quick-check-full-lint.mjs` is the previous copy of the script,
kept to replay the change that motivated this budget work: the whole-repository
lint in that copy times out on the #3811 lint config change under one CPU, and
the current script finishes the same change. The separate `quick-check-proof.yml`
lane measured the same hook on hosted Ubuntu and proved a type error stops the
push; it re-ran a subset of those shards and is gone (HTPR-9450).
