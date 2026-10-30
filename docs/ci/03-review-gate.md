## Review gate

- The private `valentinyeo/hypertask-reviewer` workflow fails over subscription-first between its configured backends (currently the ChatGPT/Codex subscription and the Claude Code subscription); the reviewer repository owns the provider order, models, and failover details, so they are not duplicated here.
- The required review gate is GitHub AI Review (`ai-review`); the former `claude-review` context is accepted during the transition so queued PRs retain their gate. Every review comment identifies the backend that produced its verdict.
- The private repository publishes that gate as a commit status because cross-repository user tokens cannot create GitHub Check Runs. Branch protection and auto-merge consume the GitHub AI Review (`ai-review`) context (or the legacy `claude-review` context during the transition).
- After publishing a final status, the private workflow dispatches the application repository's auto-merge evaluator for that PR. It does this for approvals, concerns, and infrastructure failures, so completion cannot be missed when CI happened to finish first.
- A five-minute application auto-merge sweep is the final availability fallback. It re-evaluates green PRs even if GitHub loses the cross-repository completion dispatch.
- A root-installed systemd timer polls every 30 seconds as the isolated `reviewdispatch` account. It validates each open PR, exact head SHA, same-repository source, and `production` target before dispatching to the private reviewer repository. The private workflow checks out only the trusted `production` copy of `.github/scripts/ai-review.mjs`; it reads PR code as data and never checks it out or executes it.
- The dispatcher records terminal GitHub AI Review (`ai-review` or legacy `claude-review`) results by commit SHA under `/var/lib/hypertask-ai-review/completed`. Each scan uses one GitHub API request to list open PRs, then rechecks only heads without a terminal marker. Keep this cache in place. With 24 or more open PRs, repeated checks of completed heads consumed the 5,000-request hourly quota and made the CI monitor report an unknown topology (HTPR-5548).
- Generated dependency lockfiles are represented by file metadata instead of their full machine-generated contents. The reviewer inspects the package manifest and CI result without spending tens of thousands of tokens on a lockfile.
- Every backend must return the same strict JSON-schema verdict. Quota, authentication, missing CLI, timeout, empty, or malformed responses advance to the next backend. A valid `APPROVE` or `CONCERNS` verdict stops the chain. If every backend fails, the required check fails closed.
- Transient provider failures retry within the reviewer workflow's own failover policy; the reviewer repository owns those retry counts.
- Existing queued PRs are discovered automatically by the local poller. The broker sends a `repository_dispatch` event, so GitHub always runs the credential-bearing workflow from the private repository's default branch. A trusted infrastructure retry uses the same event and exact PR head SHA; branch-selectable `workflow_dispatch` is forbidden.
- Dispatch markers are reconciled against both the current GitHub AI Review (`ai-review` or legacy `claude-review`) status and the named private workflow run. Queued or running reviews remain protected for their full duration; the 30-second poller makes a cancelled, failed-before-status, or vanished run retryable after a five-minute GitHub propagation grace.
- Automatic dispatch is capped at two attempts per head: the initial run and one recovery. Further infrastructure-only retries must use a trusted `repository_dispatch` request for the exact PR head, preventing an unhealthy provider from consuming quota indefinitely without making a credential-bearing workflow branch-selectable.
- DeepSeek-produced PRs keep the `hold` label. The automated verdict is evidence, but a trusted release session must still remove the hold before merge.
- Subscription credentials belong only to the isolated `aireviewer` OS account. Only the private repository's `htreviewrunner` identity may invoke the root-owned wrappers. The broker runs only as `reviewdispatch`; the general `ghrunner` identity used by application jobs can invoke neither boundary.
- The broker's cross-repository credential is supplied through a `reviewdispatch`-only curl config file, never a command argument or application workflow environment.
- The safe manual retry command below sends `repository_dispatch` with a numeric PR and exact 40-character head SHA. The private workflow and reviewer validate both before using credentials.

### Trusted manual review retry

Use this only for an infrastructure failure, not to rerun a valid negative verdict. Confirm the PR is open, targets `production`, comes from this repository, and still has the exact head SHA. This payload follows `.github/scripts/subscription-review/dispatch-review` and runs the private repository's default-branch workflow, never a PR-selected ref.

```bash
PR=1234
HEAD_SHA=$(gh pr view "$PR" --repo hypertask-ai/hypertask --json headRefOid --jq .headRefOid)
[[ "$PR" =~ ^[1-9][0-9]*$ && "$HEAD_SHA" =~ ^[0-9a-f]{40}$ ]] || exit 1
jq -n --arg pr "$PR" --arg sha "$HEAD_SHA" \
  '{event_type:"review_pr",client_payload:{pr:$pr,head_sha:$sha}}' \
  | gh api --method POST repos/hypertask-ai/reviewer/dispatches --input -
```

Use a trusted identity with dispatch access to the private reviewer repository. The private workflow and reviewer revalidate the PR and head before using credentials.
