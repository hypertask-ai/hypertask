---
name: speed-analyst
description: SPEED RUNNER only, read daily live speed numbers, investigate and ship one measured fix, learn in the playbook, and research new performance methods weekly
---

# Speed analyst

**SPEED RUNNER takes speed work only.** Route non-speed work to another runner. Measuring is deterministic; choosing causes and experiments needs a high-capability model at high reasoning effort. Use `/intensity` when available. Do not turn analysis into a script or a second bot.

This is the map, not a parallel `/ship`. Read [PLAYBOOK.md](PLAYBOOK.md) first and update it **after every investigation and every weekly research round**, including no-win and failed experiments. Source: https://app.hypertask.ai/detail/project-4060/232.

| Step | Load / do | Done when |
|---|---|---|
| Daily read | `node scripts/speed/measure.mjs --latest`; [measurement contract](../../../scripts/speed/README.md) | Latest private history is complete and current, QA 2343 and production commit verified; stale, failed or changed-deploy runs say Can't verify |
| Pick one | Playbook, then `.claude/skills/fix-slow-page/SKILL.md` | Biggest >15% seven-day regression first, otherwise slowest content-visible cohort; repeat under matching conditions, preserve failures and variance; no invented target from an open question |
| Deep investigation | Resolve `$COMPANY_SKILLS_DIR` or `~/projects/company-skills`; load `skills/speed-check/trace.md`, `diagnose.md`, then `tools.md` only as needed | Separate CDP and Playwright trace, network waterfall/duplicate calls, local production bundle analysis, available Server-Timing and app query-count instrumentation isolate the limiter through route, auth, controller, queues, cache/realtime and render |
| File one | Search existing speed tickets/open PRs including archived/deleted through CLI or approved app API; owning SPEED RUNNER uses `vcc` | One `[SPEED]` ticket per measured slow spot on board 15, before median/p90/range/N, cache/profile, commit, exact command, limiter and private safe evidence; helpers only report to their owner, never board writes |
| Fix and prove | `/ship <full ticket URL>` and `fix-slow-page` | Smallest behavior-preserving fix, failing regression test, same-condition five cold/five warm before and after, no dropped slow runs, uncertainty explicit; existing `performance/evidence` and app budgets retained; deploy and live `verify-qa` pass before close |
| Learn | [PLAYBOOK.md](PLAYBOOK.md), shared `speed-check/improve-skill.md` for shared harness lessons | Record what found a real problem, false leads, each idea tried with measured result, next probe and per-ticket ms scoreboard; a script probe change gets a test and ticket/PR, never relaxed safety/budgets |
| Weekly research | Current `package.json`, lockfile resolved versions, runtime/deploy identity, official releases and changelogs plus open-ended write-ups | Dated playbook round, scored experiments, sources, one chosen experiment or a justified no-go; prepare a plain-language weekly digest for Valentin's review on the relevant ticket via the owning runner's `vcc` |

## Research without a fixed ceiling

Start from the app's actual versions, not old docs. Investigate Next.js, React, Node, Prisma, the Neon connection driver/pooler, Vercel features, Upstash/QStash and Turbopuffer. Read official release notes, migration/breaking-change guides, limits and costs. At the initial seed the app uses `@prisma/adapter-pg`, not `@neondatabase/serverless`: a driver migration is an experiment, not an installed dependency. Expand into browser APIs, rendering, scheduling, caching, data access and serverless cold-start techniques. Study engineering write-ups from Linear and Superhuman and other fast apps; reproduce the mechanism on our workload instead of copying their UX or trusting a marketing number.

Each idea: source/date, installed vs candidate version, Hypertask bottleneck it addresses, expected ms/bytes gain or honestly unknown, **gain 1-5 / cost 1-5 / risk 1-5**, and one falsifiable experiment with fixture, baseline, acceptance threshold, correctness checks and rollback. Priority = gain / (cost × risk); assumptions stay separate from measurements. Score rejected ideas too so next week does not repeat them. Low-risk, no-behavior-change experiments get a speed ticket, not a broad upgrade spree.

An upgrade that changes product behavior, price, login/access or a hard-to-undo contract needs **one plain-language `Question:` for Valentin on that ticket**, with a recommendation and the user-visible tradeoff. The owning runner posts it through `vcc`, mentions Valentin and follows `/ship`'s decision lane. No product decision in a PR or helper chat.

## Safety and existing probes

- QA-normal saved state and fixture only, per `verify-qa` Logins. Never owner/customer credentials, live load tests, auth dumps, token-bearing traces or app writes during measurement. The timer never files tickets.
- Query counts: existing `src/lib/queryCountTracker.ts` `[n+1-detector]` app logs and existing PostHog/readiness/realtime telemetry, not Prisma/SQL/database-client lookups of board content. The detector warns at 11+ in a chain, not an exact per-request counter. Missing app instrumentation says unavailable; add a reviewed app probe only when justified.
- Reuse `scripts/report-app-project-vitals.mjs` (`npm run performance:field`), `scripts/check-app-performance-budget.mjs` and existing `scripts/check-speed-pr-evidence.mjs`; do not replace field p75 with synthetic medians. Traces are private and captured separately from timed samples.
- Helpers have no board-write identity. Only the owning SPEED RUNNER files, claims and updates via `vcc`; never assign/remove a human or add Valentin. Identical-output performance is flag-exempt; deliberate behavior changes follow the app flag rules.
