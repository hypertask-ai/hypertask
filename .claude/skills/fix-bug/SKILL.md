---
name: fix-bug
description: Reproduce wrong behavior, prove its cause, and ship the smallest tested correction.
---

# Fix a bug

Use [/ship](../ship/SKILL.md) for claim, gates, PR, deployment, live QA, and cleanup. Follow [repository flag policy](../../../AGENTS.md#feature-flags-for-new-user-facing-behavior). A bug fix restores intended behavior; new behavior uses [ship-feature-behind-flag](../ship-feature-behind-flag/SKILL.md).

## Before coding

Read the ticket and reproduce the problem on production. For security findings, use the read-only checks in [security-findings](reference/security-findings.md). If it does not reproduce, record that fact rather than guessing at a change.

Trace the real entry point through affected middleware, routes, controllers/services, auth, queues, realtime, and caches. Confirm the cause with runtime evidence or a failing behavior check. Reading code alone is not proof. Fix the first wrong state, not a later symptom.

For money, access, security, or irreversible-data work, load [interrogate](../interrogate/SKILL.md) before coding and resolve required decisions. Ordinary ai-review work must not use it. For any rendered change, load [reuse-existing-ui](../reuse-existing-ui/SKILL.md); reuse the real shared component instead of rebuilding it.

## Make and prove the correction

1. Capture the failure through the real implementation or external boundary. Never copy the implementation into a test or assert only source strings. Exercise each independent input form; clipboard handlers need both items and files paths. Every access/security refusal also needs a legitimate still-allowed caller through the same boundary.
2. Make the smallest complete correction. Apply the ticket-specific bugfix flag unless an existing exemption applies. Keep server authorization independent of client visibility. Follow the registry documentation instead of editing shared generated lists.
3. Write the targeted behavior tests with the repo's test helpers and CI's Node major, push, and let CI run them; never run tests or builds on the VPS. A local run killed with exit 137 or similar is not a blocker and not a failed repair: push and let CI prove it. Never mark the ticket blocked on HT Product Lead for a killed local test. Keep the CI run link and result in agent activity. Never convert TypeScript into JavaScript just to make a test import work.
4. If a repair fails, undo only your own disproven change and re-test the cause before another repair. Never stack guesses or revert someone else's work. After two failed repairs, record the blocker and hand off under /ship.
5. For rendered output, capture the before baseline and run [verify-on-phone](../verify-on-phone/SKILL.md) before the PR. Flag-exempt does not mean invisible: spelling and restored screens still need visual proof. Check the matching feature-map recipe.
6. Run [simplify-before-pr](../simplify-before-pr/SKILL.md). For UI, also run [design-compliance](../design-compliance/SKILL.md). Run [update-docs](../update-docs/SKILL.md) when user-visible behavior changes.
7. Write the PR body before opening it. Start with **Summary for non-engineers** and include the opening action plus **What went wrong**, **What changes**, **What you will see**, and **Watch out for**. Use [open-pr.sh](scripts/open-pr.sh) with a body file; its usage owns syntax. It pushes and opens, but does not branch or commit. Keep one PR, auto-merge off, ticket In Progress.
8. Bind the PR and follow /ship's current-head checks, fresh ticket reread, merge, deployment, and [verify-qa](../verify-qa/SKILL.md). A skipped required test is not a pass. Diagnose red checks with `ci-why`; never toggle labels or bypass protection to force green.

## Keep the change in scope

Use your own worktree off production. Native CLI fixes belong in the Zig CLI repo, never the retired Node package. Previews share production data and cannot host destructive tests. Prefer clearer names, assertions, and logs over explanatory code comments. Helper briefs contain the observed cause, failing check, scope, and the [root-cause](principles/fix-root-causes.md), [proof](principles/prove-it-works.md), and [behavior-test](principles/test-behavior-not-implementation.md) principles, not another copy of the workflow.

If flagged behavior fails live, hold it at Owner + QA through the approved failure path before repairing. Never switch a flag Off. Never widen an existing flag as part of a routine self-merge. Document what users now experience before closing; a merged PR alone is not completion.
