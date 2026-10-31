## Pre-push quick check (HYCI-9)

`.githooks/pre-push` runs `scripts/quick-check.mjs` before every push from a
checkout, so a formatting, lint or type error is found in seconds instead of
after the `ci-checks` job. `scripts/install-git-hooks.mjs` copies the hook into
`$(git rev-parse --git-common-dir)/hooks/pre-push`, so one install covers every
worktree of the checkout. The `prepare` npm script runs the installer, so a
fresh clone gets the hook from `npm install` without a manual step. An existing
unrelated `pre-push` hook is left alone, and the hook itself exits quietly when a
worktree predates `scripts/quick-check.mjs`, so an older branch never blocks on a
missing script.

The check is scoped to the change: files are the merge base of `HEAD` and
`origin/production`, the same base `scripts/lint-changed.mjs` uses. ESLint runs
with `--fix` on those files, and when it rewrites one the push stops so the fix
is committed. A checked file that differs from `HEAD` stops the push as well:
the tools read the working copy, so only a committed change is what the push
carries. A lint configuration change runs the full lint; a `tsconfig` or
dependency change runs the full type check. The type step otherwise writes
`.cache/tsc/quick-check.json`, a tsconfig that includes only the changed
TypeScript files and inherits the repository compiler options, and type-checks
that program. ESLint and tsc start together.

CI keeps the whole-program gates: the `ci-checks` job still runs the full ESLint
pass and `next typegen && tsc`. The hook only moves the same errors earlier, so
it never replaces a required check and adds no required context.

Both gates stay inside the time budget. ESLint and tsc are killed, with their
process group, at 10 seconds for a normal change and 60 seconds for a full lint or
full type check; a killed or skipped gate never blocks the push, because a killed
process is not a verdict. `npm install` is
required for the hook to run: without `node_modules` it reports the missing tool
and passes. `HYPERTASK_SKIP_QUICK_CHECK=1` skips the hook for one push.

`.github/workflows/quick-check-proof.yml` measures the real hook on hosted
Ubuntu, is path-filtered to the hook files, and adds no job to ordinary pull
requests. It fails the run when the measured run reaches 10 seconds and proves
that a file with a type error stops the push.
