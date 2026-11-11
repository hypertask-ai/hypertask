---
name: security-findings
description: How to handle a Strix scanner finding, and how the weekly scan runs.
---

# Security findings

## Read production Vercel Security Review states

Read the states on a GitHub-hosted runner with the existing Actions secret, so
no server login is involved and it keeps working when the saved `vercel-ht`
login is rejected or challenged. Never copy another login, print credentials,
or request broader access:

```bash
gh workflow run vercel-security-findings.yml --repo hypertask-ai/hypertask \
  --ref production
```

The workflow is production-branch-only and reads the production Vercel
project. It follows the read-only endpoint used by Vercel CLI 65.12.1
`security vulnerabilities list --status all --environment production`:
`https://vercel.com/api/omniagent/v1/security-findings`. Every request sends
`status=open,closed,dismissed` explicitly, so Vercel's `open` default can
never hide a closed or dismissed finding.

Find the dispatched run, then read its log once it succeeds:

```bash
gh run list --repo hypertask-ai/hypertask --workflow vercel-security-findings.yml --limit 1
gh run view <RUN_ID> --repo hypertask-ai/hypertask --log
```

Only trust a successful run with both `BEGIN COMPLETE PRODUCTION SECURITY
FINDINGS` and `END COMPLETE PRODUCTION SECURITY FINDINGS` markers. All pages
and statuses are included: open, closed and dismissed. Match a fixed warning
using its project finding number or finding ID; `resolved-in` records its
closing commit when Vercel supplies one. Record the relevant states and full
Actions run URL on the ticket using your own `vcc activity add` identity.

Actions logs include only validated finding numbers, IDs, status, severity,
closing commit, the `Scan coverage` line and a read timestamp. Titles, source,
descriptions, fixes and secret values are excluded. No raw findings are
uploaded as artifacts and no MCP credential or ticket writes are needed in
Actions.

## How a Vercel scan is requested

Security Review is push-triggered. Vercel's GitHub app reviews the code a push
adds, so a review only covers a commit that existed when
`Review Deployments Automatically` was on in the team's Agent settings. There is
no API, CLI or GitHub command that requests a review: `vercel security
vulnerabilities` reads and triages findings only, and this workflow reads. The
only lever is that team setting, which the team owner flips in the dashboard.

The workflow therefore prints a `Scan coverage:` line in every report. Only a
review whose check run is `completed` counts, and the date it prints is that
run's completion time; a review that is queued or still running covers nothing
yet, so a dispatch that lands mid-scan reads as uncovered instead of claiming
the fix. Findings are read only after that coverage snapshot is fixed, so a
review that finishes during a run cannot lend its commit to older states.

- `the newest completed Vercel Security Review covered production tip <sha> and
finished at <date> ... does not cover it` means the newest finished review is
older than production HEAD, so no scan covers it.
- `none of the 200 first-parent production tips ... carries a completed Vercel
Security Review` means no review is running at all, and no scan can be requested
until an owner turns Security Reviews back on.

The read walks production's first-parent history only, so a commit that reached
production inside someone else's merge is never offered as production's last
reviewed tip.

Never present a reader run as a fresh scan. A fixed warning can only be called
verified when `Scan coverage` names the commit that carries the fix itself, or a
first-parent production tip whose review covered that fix commit. A review of a
later, unrelated commit does not cover the fix, because a Security Review covers
only the code its own push changed. Never dismiss a warning to shorten the list;
a dismissed finding hides the defect from every future read.

An authentication failure, unexpected response or incomplete page sequence
fails the job without publishing a report rather than reporting zero findings.
It also fails when the coverage read cannot be trusted, so a missing scan can
never look like a clean one.

Check the run once, record a recheck time on the ticket, and let the launcher
resume; do not watch/poll.

## Strix findings are candidates, not confirmed bugs

A Strix ticket names a suspected vulnerability with a severity and CVSS
score. Treat it as a lead, not a verified bug. Validate by hand before
touching code:

- **Reproduce it yourself.** Read the route source, or send the exact
  unauthenticated/malformed request with `curl` against a local build.
- **Never send a mutating or destructive request against production.**
  `app.hypertask.ai` is live and shares the real database. Read-only
  checks only, and only against a local build when the request writes,
  deletes, or escalates.
- If it doesn't reproduce, say so in the ticket and close it. Don't fix
  a bug that isn't there.

## Shipping the fix

A confirmed security fix is still a fix-bug PR, opened with:

```bash
open-pr.sh <PREFIX-NNN> BUGFIX "<short title>" --body-file <path> --lane valentin-review
```

Security fixes always go to `valentin-review`, never `ai-review`. Never
widen a feature flag or access rule to make a fix land easier.

## How the weekly scan runs

- A systemd timer fires `strix-weekly.sh` Sunday 03:00.
- It scans local source only (`./src`), never a live URL, through a
  local proxy that runs model calls on the ChatGPT subscription
  (no per-token key).
- Budget-capped at $10 per run.
- Each finding above medium severity is filed as a board-15 ticket,
  deduped by title so a repeat run doesn't refile the same finding.
- Raw run output lands in `strix_runs/` in the `hypertasks` repo.
  Filed tickets land on board 15 (Bugs section), unassigned, labeled
  `security`.
