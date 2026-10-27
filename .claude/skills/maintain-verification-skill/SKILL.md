---
name: maintain-verification-skill
description: Source-only weekly feature-map upkeep, free GitHub citation checks and a runner ticket for verified drift. Adapted from pstack by Lauren Tan, MIT.
disable-model-invocation: true
---
Source: pstack 0.15.9 by Lauren Tan, https://github.com/cursor/plugins/tree/main/pstack, skills/maintain-verification-skill/SKILL.md. MIT License, Copyright (c) 2026 Lauren Tan. Adapted for Hypertask (YPER4-610).

# Maintain the verification skill

The fixed target is `.claude/skills/verify-qa/`, with area pages in `.claude/skills/verify-qa/reference/feature-map/`. No target discovery or generated inventory. The weekly timer reads source only; the ticket's runner owns live verification.

## Outcomes

- **clean**: all selected pages received source coverage and the checker found nothing worth shipping. State which pages were covered and which were deferred; source-only clean is not live QA or whole-map coverage.
- **changed**: a runner ships one PR of proven verification-skill corrections through `/ship` and completes the listed live recipes with `verify-qa`.
- **blocked**: a helper, prerequisite or safe correction could not finish. Name the blockage, preserve pending pages and report incomplete coverage; never call it clean.

## Edit scope

During upkeep, edit only `.claude/skills/verify-qa/`: its SKILL.md, feature map and harness scripts it owns. Helpers are entirely read-only. Never edit product code in the upkeep PR. Wrong documentation is doc drift; behavior that should still work is a product regression to report separately, not paper over in the map. Keep reports, answers, gates and intermediate state outside Git under `~/.local/state/maintain-verification/`.

## Pass

1. **Index hygiene.** Compare INDEX.md's table with every sibling Markdown file. Correct missing, duplicate and dead entries only in the runner's ticket, not during discovery. The offline checker also verifies backticked checkout paths and API route citations. It ignores globs, placeholders and explicitly scoped external-repository paths; a negated endpoint is not a cited live endpoint. Pages Router `.ts` files, index routes, App Router `route.ts`, route groups, dynamic segments and catchalls are resolved from source. It does not prove HTTP methods, auth or runtime behavior.
2. **Source wave.** Fetch `origin/production` and inspect a fresh detached checkout, never a dirty caller checkout. Pick pages with cited paths changed since the last successful checkpoint; include changed map pages and outstanding backlog. Include checker problems in the report even when their pages do not need another source helper. First run queues every area. At most eight helpers per invocation, two concurrently; log every deferred page and carry it forward. One high-effort Codex helper per picked page, with the current Token ladder line and unlazy gates outside the checkout. Helpers read source only, never drive the app or spawn helpers. Each returns feature summary / source entry points / drift with path:line citations or `none` / one live recipe. Strict JSON validation rejects empty or malformed answers; a failed helper retries once, then remains pending and makes the run blocked.
3. **Reconcile.** The ticket runner reads every returned summary for the drifted pages, spot-checks the citations and merges overlapping recipes into as few app states as practical. Sweep recent churn for missing customer surfaces, requiring a concrete source path before calling a feature missing. Unpicked pages remain deferred, not silently clean. The timer creates no ticket if source reports no drift and the checker is clean. Otherwise it files at most one drift ticket per ISO week on project 4060 as RUNNER 8; the description includes each drifted page's source evidence and one live recipe, checker findings and skipped pages. Checker-only pages use their documented drive recipe; index-only drift needs no app clicks. Failed helpers are named, not invented into drift.
4. **Ticket-owned live pass, never an unattended drive.** HT Product Lead, 2026-10-23: "Yes to the plan as written, including skipping the unattended weekly live drive. A weekly 37-page browser run on the VPS goes against the load rules, and clicking only the pages that drifted, through the ticket, covers the same risk." The runner who picks the filed ticket uses `/ship`, fixes the pages and performs every listed recipe with `verify-qa` after deploy, on a machine permitted to drive the app. Doctor first; recheck health after errors, recover the session, keep going on reachable paths. Use only the documented QA identities, never Valentin's browser or credentials. Record unreachable prerequisites and the closest covered path. The weekly timer does not log in, refresh cookies, click, send API requests or run app tests.
5. **Triage.** Wrong or missing customer-facing description: doc drift. Working behavior the harness cannot drive: harness gap; fix only the verification skill's own harness, keep scripts executable and document their invocation. Broken intended behavior: product gap, report separately without rewriting the expected behavior away.
6. **Ship or stop.** Runner re-reads every changed file, ships one scoped PR with `/ship`, performs the listed clicks with `verify-qa`, then closes the ticket only after evidence passes. Clean or blocked discovery opens no PR. Keep concise source/live coverage, unreachable paths, confirmed drift and outcome in private scratch state; do not commit run notes.

## Run and test

From the repository root, with Node 24, Bash, Git and standard Linux utilities; no npm dependencies, paid AI API or new keys:

```bash
node --test .claude/skills/maintain-verification-skill/scripts/feature-map-check.test.mjs
node --check .claude/skills/maintain-verification-skill/scripts/feature-map-check.mjs
node --check .claude/skills/maintain-verification-skill/scripts/maintain-verification-state.mjs
bash -n .claude/skills/maintain-verification-skill/scripts/maintain-verification-weekly
node .claude/skills/maintain-verification-skill/scripts/feature-map-check.mjs
.claude/skills/maintain-verification-skill/scripts/maintain-verification-weekly --dry-run
.claude/skills/maintain-verification-skill/scripts/maintain-verification-weekly --dry-run --pages login.md,boards-and-views.md
```

The tests use temporary Git repositories, HOME, local remotes and fake hax/vcc/systemctl commands: no real helpers, network, board writes or installed services. The checker prints a Markdown list, appends the same report to `GITHUB_STEP_SUMMARY` when set and exits 1 on problems. An optional positional checkout path lets the timer check its detached production checkout.

`--dry-run` still fetches and starts the selected read-only subscription helpers, builds the HTML report and updates the incremental queue, but never calls vcc or records a filed marker. It prints the description path. Drift remains queued for a later filing run. `--pages` forces existing area-page sibling names (comma-separated, no paths); the eight-helper limit still applies and other queued pages remain pending. `--repo PATH` selects the fetch checkout. A load status containing `hold` exits 0 after fetch, without helpers or advancing state; missing status fails closed. These commands are source-only, not a replacement for live QA.

The non-required `feature-map-check` GitHub job runs the tiny tests then the checker on Mondays at 03:37 UTC, manual dispatch and scoped PRs to production. It uses free GitHub-hosted Ubuntu, pinned checkout/setup-node, Node 24, only `contents: read`, no installs or secrets. Real stale citations make it red; repair them in their own ticket, not by weakening checks. It is not a required merge check.

## Install after shipping

Run only from a durable production checkout, after merge, never as part of a build or test:

```bash
.claude/skills/maintain-verification-skill/scripts/maintain-verification-weekly install
systemctl --user list-timers maintain-verification-weekly.timer
systemctl --user status maintain-verification-weekly.service
journalctl --user -u maintain-verification-weekly.service
```

Installation copies the wrapper, checker, state helper and user units into `~/.local/lib/hypertask/maintain-verification/` and `~/.config/systemd/user/`, records the main production checkout in `repo`, disables the legacy `verify-map-upkeep.timer` when present and enables the replacement. Reinstall after script updates. The Monday 03:43 UTC timer is persistent (missed-run catch-up), Nice 19, idle I/O, 2 GB maximum memory, three-hour timeout and private umask. Each helper times out after 18 minutes, with one retry, so the four two-helper batches fit the service timeout. Git fetch has a two-minute timeout. The user-wide flock prevents overlapping manual/timer runs.

Runtime needs Node 24 on the service PATH, `hax`, `vcc` with the existing RUNNER 8 session identity, and `~/projects/token-ladder/bin/token-ladder pick --role runner --harness hax --json`. Runner admission uses the machine-readable Codex decision, not human-facing mode text. CPU/RAM refusal defers pending pages without helpers or filing; command failures and invalid approvals fail closed. No new credentials; never print or commit tokens. No paid AI API. Helper stderr is discarded and answers stay only in private state. The timer fetches source but does not query the app or database; only vcc creates the approved drift ticket.

State holds `last-run-sha`, `pending.json`, `filed-<YYYY-Www>` and one private run directory with plan, checker report, JSON answers and description. A successful filing records the weekly marker; a failed filing records neither marker nor checkpoint. Subsequent findings in the same week remain in that run's report and pending queue for the next eligible week instead of creating duplicate tickets. Deleted/unavailable historical SHA queues all pages again. Failed helpers and capped pages are retried on a later invocation; run again manually to drain a large initial backlog. Detached checkouts are removed only when clean; unexpected edits leave the checkout for inspection.

Stop with `systemctl --user disable --now maintain-verification-weekly.timer`; stop an active service with `systemctl --user stop maintain-verification-weekly.service`. Inspect private state before retrying failures. Never delete the lock file while a run is active or erase a filed marker to generate duplicate tickets.
