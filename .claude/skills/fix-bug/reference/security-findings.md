---
name: security-findings
description: How to handle a Strix scanner finding, and how the weekly scan runs.
---

# Security findings

## Read production Vercel Security Review states

The server's saved `vercel-ht` token is invalid. Do not copy another login,
print credentials, or request broader access. Use the existing Actions secret
from a GitHub-hosted runner instead:

```bash
gh workflow run vercel-security-findings.yml --repo hypertask-ai/hypertask \
  --ref production -f ticket=287 -f project=11514
```

Set `ticket` to the receiving ticket's unique index and `project` to its board
ID. The workflow is production-branch-only and reads the production Vercel
project. It follows the same read-only endpoint used by Vercel CLI 65.12.1
`security vulnerabilities list --status all --environment production`:
`https://vercel.com/api/omniagent/v1/security-findings`.

Read the receiving ticket's agent activity with `vcc activity list HYCI-287`.
All pages and statuses are included: open, closed and dismissed. Match a fixed
warning using its project finding number or finding ID; `resolved-in` records
its closing commit when Vercel supplies one. Titles, source, descriptions,
fixes and secret values are deliberately excluded. This is finding-state proof,
not a request to trigger a new scan or dismiss a warning.

Actions logs contain counts only. No raw findings are uploaded as artifacts.
An authentication failure, unexpected response or incomplete page sequence
fails the job rather than reporting zero findings. Check the run once, record
a recheck time on the ticket, and let the launcher resume; do not watch/poll.

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
