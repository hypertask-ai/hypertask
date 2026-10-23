---
name: verify-visual
description: Before merging a Hypertask UI PR, check whether it moved a main screen using the Visual Regression workflow and diff PNGs.
---

# verify-visual

## Launch

Heavy runs only in GitHub Actions, in **Visual Regression** (`.github/workflows/visual-regression.yml`). The VPS only writes code and reads results. Never run builds, Playwright, Docker or the visual runner locally; do not dispatch or retry workflows to get green.

Non-draft PRs targeting production trigger on the workflow's screen/harness paths. `scripts/visual-regression-ci.mjs` builds base then head serially on one runner, resetting disposable DB/Redis and seeding with `scripts/seed-browser-smoke.mjs --visual` for each. It waits for `/login` and search health before capture, then stops its own servers. No production data or QA credentials.

## Doctor

Set `PR` to the PR number and `RUN_ID` from its `visual-regression` check link:

```bash
gh pr checks "$PR"
gh pr view "$PR" --json headRefOid
gh run view "$RUN_ID" --json workflowName,headSha,event,status,conclusion,url,jobs
```

Require the current PR head, the correct base in the run's checkout details, and completed base/head captures in the GitHub step summary. Queued, missing, stale, cancelled, skipped or setup-failed runs are not visual proof. No run can mean path filtering, not unchanged pixels.

## Drive and screen map

The workflow runs `e2e/visual/visual.spec.ts` with `e2e/visual/playwright.visual.config.ts`. Each screen runs at desktop 1440x900 and phone 390x844 in Porcelain, ten comparisons per build. The fixed-time fixture enables the screen controls; this is not every live flag state or theme.

| Screen ID | User path and expected state |
|---|---|
| `board` | Seeded board, To do/Done columns and the fixture card visible |
| `task-detail` | Click that board card, title/description, two comments and one composer visible |
| `comment-box` | Cached-open task scrolls the uniquely matched last seeded comment into view, then the desktop composer only (phone composer is fixed); both stay in viewport and desktop composer follows comments |
| `ctrl-j` | Board, Control+j, empty writer with Describe the task textbox; never submit |
| `inbox` | /inbox loaded, inbox panel and list visible |

## Evidence and triage

Read the run's failed screen and viewport in the GitHub step summary. On failure, download the PNGs and error-context.md artifact within its 7-day retention; set `TICKET` to the ticket key:

```bash
gh run view "$RUN_ID"
gh run download "$RUN_ID" --name visual-regression-diffs --dir "$HOME/.local/state/vcc-evidence/$TICKET/visual/$RUN_ID"
```

For that screen/viewport, read error-context.md for the named failing step and page snapshot, then compare expected (base), actual (head) and diff PNGs together. Comment-box navigation, scrolling, asset/geometry settling and desktop order checks have 15-second step limits. Check moved, missing, covered or resized UI, especially composer order. Missing PNGs or build/auth/readiness errors mean incomplete/setup failure, not a pixel match. The artifact uploads only on failure and may be absent before capture.

A real regression is an unintended difference: fix it, never regenerate expected images from head, mask the change or loosen thresholds. An intended change needs human approval in the PR description: `Visual change approved: <ticket URL>`. Confirm approval covers the observed screen change; it does not turn the job green or waive unrelated regressions.

Ticket proof, via `vcc` by the owning session, is one line on what was checked plus the GitHub run link: `Checked board, task detail, comment box, Ctrl+J and inbox at desktop/phone in Porcelain: PASS / FAIL / SETUP FAILED. <GitHub run URL>`. Name approved differences when relevant. This informational v1 does not replace browser-smoke, layout locks, premerge evidence or live QA (`.claude/skills/verify-qa/SKILL.md`).

## Cleanup and maintenance

Actions owns disposable services and server teardown. Keep downloaded evidence after cleanup; never upload auth state, tokens, traces or raw app logs.

When the workflow, spec, config or screen paths change, reconcile this map and the INDEX row with source. The drift check `tests/verify-visual-skill.test.cjs` runs in GitHub CI; never run tests on the VPS. Review all mapped screens in the next natural GitHub run, doctor first and again after a surprising failure. Fix doc drift here; report product regressions instead of rewriting the map to bless them. Record clean, changed or blocked with the run link and uncovered prerequisites; unavailable Actions proof means blocked, not verified.
