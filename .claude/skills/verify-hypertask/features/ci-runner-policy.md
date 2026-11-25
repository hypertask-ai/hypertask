# CI runner placement policy

## Sub-features

- `ci-runner-placement-policy` CI runner placement policy.

## How to get to it (user POV)

Production pull requests run PR Guards Trusted.
Its runner-policy step contributes to the required pr-title result.
The separate title step still binds the ticket.
No application screen changes.

## Driving it with agent-browser

No browser is involved. Drive it with `gh` and the checker itself, from a clean
checkout of `origin/production` (the checker reads `docs/ci-policy.yml` from the
working tree, not from `--ref`).

1. `gh repo view hypertask-ai/hypertask --json visibility,isPrivate` returns
   `PUBLIC`/`false`; every later result depends on it.
2. `git fetch --no-tags origin production:refs/remotes/origin/production` and
   `SHA=$(git rev-parse origin/production)`.
3. `NODE_PATH=$PWD/node_modules node .github/scripts/ci-runner-policy.cjs
   --repo hypertask-ai/hypertask --ref $SHA` prints one line:
   `hypertask-ai/hypertask: public; GitHub-hosted ubuntu-latest only; standard
   hosted minutes are free; N jobs checked; workflow digest <64-hex>`. A missing
   `NODE_PATH` fails on `js-yaml`.
4. Negative control without touching origin: add a detached worktree
   (`git worktree add --detach /tmp/policy-neg HEAD`), change one
   `runs-on: ubuntu-latest` to `runs-on: self-hosted`, commit, run the same
   checker with `--ref $(git rev-parse HEAD)`, require exit 1 and
   `CI runner policy: <workflow>/<job>: public app CI requires GitHub-hosted
   ubuntu-latest`, then `git worktree remove --force`.
5. On a current production PR, read the combined verdict:
   `gh api repos/hypertask-ai/hypertask/commits/<head>/statuses --jq
   '.[]|select(.context=="pr-title")|{state,description}'` shows `success` /
   `Trusted guards passed`; the run's jobs include `pr-guards-trusted` and its
   step `Check workflow runner policy` is `success`.
6. Ticket binding is the separate `title` step in the same job; a successful
   `pr-title` means the ticket key is present. Read the run's steps rather than
   the status text when the ticket key matters.
7. Skip the old `token-ladder hook-prompt` step: it prints nothing without
   `--account <id>` and carries no runner-policy wording.

## Gotchas

- Candidate policy or checker controls its own approval.
- Missing or stale runner validation publishes a green title status.
- Runner validation breaks existing ticket binding.
- An unavailable visibility lookup becomes approval.
- The private-hosted approval is bound to a digest of workflow paths and
  contents (`.github/scripts/ci-runner-policy.cjs:15,45-53`), so a workflow
  change invalidates it. The live hole is the other way round:
  `docs/ci-policy.yml` is not in that digest, so a policy edit keeps the old
  approval. The approval path is dead today because
  `docs/ci-policy.yml:38` is `null`.
- A stale or dirty working tree silently evaluates production workflows
  against the wrong policy, because the policy comes from the checkout and the
  workflows come from `--ref`.

### What proof to collect

Save the checker's one-line verdict with its digest and job count, the
self-hosted negative control's exit code and message, the PR's `pr-title`
status, and the trusted run's `Check workflow runner policy` step.
The `ship-scripts-tests` fixtures run the real checker and status publisher,
but that workflow is path-filtered: a PR touching none of its paths has no
fixture log, so read the current-head run before promising one.
No flag or app account is needed for the policy command.

### Cleanup

No app fixtures or production settings change.
Keep sanitized proof outside the worktree.
