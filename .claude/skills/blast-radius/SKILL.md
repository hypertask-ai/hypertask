---
name: blast-radius
description: Before the PR for work outside the usual lane, find breakage beyond the diff and prove safety by running real code
---

# Blast radius

Load before the PR for anything outside the usual lane, or when asked what a change could break. Caller lists alone are not enough.

## Steps

1. Read the ticket diff against `origin/production`, including uncommitted changes. Name what changed, including effects not clear from the diff.
2. Find the one or two facts safety depends on. Spend time proving those facts, not listing guesses.
3. Follow what symbol search misses: API payloads, database fields, wire formats, feature flags, queues, cache invalidation and downstream readers. Read the pinned library source and local patches. Check timing, teardown and runtime differences.
4. List every shared thing the change reads or writes that something else also uses: cache folders and build caches, global CSS layers, z-index and portal stacking, shared state or lock files, environment and build config. For each one, ask what happens when another user of it runs before or after yours, then run that order for real: let another suite or page fill it first, run yours, then the other again, in the order CI or the app runs them. Prefer giving each user its own copy over sharing one. A failure that shows only on a second run or in another suite points at persisted state first. (pstack separate-before-serializing-shared-state and fix-root-causes, YPER4-440.)
5. Trace each plausible failure to real `path:line` evidence. Keep confirmed risks separate from risks checked and cleared. Say how likely each is and what it would cost.
6. Run a small script or test that calls the real implementation and fails if the safety fact is wrong. When safe, reproduce the affected path in the running app. No destructive production or preview tests.
7. Record the command, result and remaining gaps in the ticket ledger. An untested claim stays unproven. Do not merge while a material safety fact is unproven.

## Proof strength

From weakest to strongest: a claim; source at `path:line`; a traced bad case that cannot happen; a passing test of real code; a repro in the running app. State where proof stopped. A convincing writeup is not proof.

## Hand-off

Keep it short: what changed, the safety fact and its proof, confirmed risks, cleared risks, and the cheapest regression check. Strip private data from shared evidence.

Source: adapted from pstack, https://github.com/cursor/plugins/tree/main/pstack.
