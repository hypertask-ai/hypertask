# Agent board scope guard

## How a customer reaches it

The "Guard agent board scope" step inside the required `ci-tests` check of every pull request and production push. It scans agent route files for direct `prisma.project/task/comment` reads that skip the shared agent scope helpers, against the reviewed exceptions and the debt list in `.github/scripts/agent-scope/`. This is infrastructure, with no app UI or account writes.

## How to drive it

After the guard is merged and its production deployment succeeds, read the production push `ci-tests` run for the merge commit: the guard step must pass and print `Agent scope: findings=..., new=0`. That is the positive control.

For the negative control, branch a throwaway PR from current production. Append one unscoped query such as `prisma.task.findFirst({ where: { id } })` to a real agent route (for example `src/app/api/agents/[agentId]/activity/route.ts`). Open a non-draft PR targeting production. Never merge it. Confirm `ci-tests` fails at "Guard agent board scope" with `New unscoped query:` naming that file and line, and that the self-test lines before it passed.

## What usually breaks

- A file prefilter or target list that silently drops agent routes (check `Agent scope targets: entries=N` stays in the hundreds).
- Python or Semgrep install drift: the step pins Python 3.12 from the tool cache and installs from hash-locked requirements.
- Stale debt after a refactor moves a listed call; the fix is deleting that debt entry, never re-adding it.
- Exceptions edited without the PR body approval line.

## What proof to collect

Checklist written before QA; check-run metadata and guard-step logs for the positive (production push) and negative (throwaway PR) runs; closed throwaway PR metadata and confirmation its branch no longer exists. Doctor: merge SHA production deployment success, login HTTP 200, and /my-tasks signed in with a QA account, with desktop 1440x900 and phone 390x844 screenshots. Record account id, never credentials.

## Cleanup

Close the throwaway PR unmerged and delete only its own branch. No QA board or production settings are changed.
