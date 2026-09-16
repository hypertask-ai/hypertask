---
name: security-findings
description: How to handle a Strix scanner finding, and how the weekly scan runs.
---

# Security findings

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
