# HYCI-77 gates

Ticket: HYCI-77 https://app.hypertask.ai/detail/project-11514/77

## G1 Branch
- [x] Worktree branch is ci-runner-1/hyci-77 based on origin/production
  - CHECK: `git -C /home/valentin/projects/.worktrees/ci-runner-1-hyci-77 rev-parse --abbrev-ref HEAD && git -C /home/valentin/projects/.worktrees/ci-runner-1-hyci-77 merge-base --is-ancestor origin/production HEAD && echo BASED`
  - EXPECT: `ci-runner-1/hyci-77` and `BASED`

## G2 Slowest pushes named from real runs
- [x] The last-day measurement exists with counts and a wall-time distribution
  - CHECK: `python3 /tmp/hyci77-measure.py`
  - EXPECT: `within10` and `last_check_counts` and `slowest=25` (25 ranked, the slowest twenty are inside it)

## G3 visual-compare no longer waits for the shards
- [x] visual-compare needs only the shared build, and still runs on non-draft PRs
  - CHECK: `node -e "const y=require('js-yaml').load(require('fs').readFileSync('/home/valentin/projects/.worktrees/ci-runner-1-hyci-77/.github/workflows/ci-tests.yml','utf8'));const j=y.jobs['visual-compare'];if(JSON.stringify(j.needs)!=='[\"browser-build\"]')throw new Error('needs '+JSON.stringify(j.needs));if(!/needs.browser-build.result == 'success'/.test(j.if))throw new Error('no build guard');if(!/draft == false/.test(j.if))throw new Error('no draft guard');console.log('VISUAL_OK')"`

## G4 No check skipped or weakened, job count unchanged
- [x] ci-tests.yml keeps the same job set and count as the base commit
  - CHECK: `cd /home/valentin/projects/.worktrees/ci-runner-1-hyci-77 && NODE_PATH=/home/valentin/projects/hypertask/node_modules node -e "const yaml=require('js-yaml'),cp=require('child_process');const now=Object.keys(yaml.load(require('fs').readFileSync('.github/workflows/ci-tests.yml','utf8')).jobs).sort();const base=Object.keys(yaml.load(cp.execSync('git show origin/production:.github/workflows/ci-tests.yml',{encoding:'utf8'})).jobs).sort();if(JSON.stringify(now)!==JSON.stringify(base))throw new Error('job set changed');console.log('JOBS_OK '+now.length)"`
  - EXPECT: `JOBS_OK 14`

## G5 Workflow wiring test updated
- [x] The pinned visual-compare wiring test asserts the new needs (CI runs it; this host runs no tests)
  - CHECK: `grep -c 'assert.deepEqual(compare.needs, \["browser-build"\])' /home/valentin/projects/.worktrees/ci-runner-1-hyci-77/tests/visual-nextjs-build-cache.test.cjs`
  - EXPECT: `1`

## G6 Docs match the workflow
- [x] The CI doc section records the new wiring
  - CHECK: `cd /home/valentin/projects/.worktrees/ci-runner-1-hyci-77 && node scripts/shared-lists/build.mjs --check 2>&1 | tail -3`
  - EXPECT: `ok` OR no output (built lists match source)

## G7 PR open, bound to the ticket, checks not faked
- [x] One PR from ci-runner-1/hyci-77 to production with an HYCI-77 title
  - CHECK: `gh pr view ci-runner-1/hyci-77 --repo hypertask-ai/hypertask --json number,title,baseRefName,isDraft --jq '[.number,(.title|test(\"^HYCI-77 \\\\[[A-Z]+\\\\] \")),.baseRefName,.isDraft]|@tsv'`
  - EXPECT: `true` and `production` and `false`

## G8 Board live
- [x] Ticket is In Progress while working and moves to its review column with the PR open
  - CHECK: `cd /home/valentin/projects/hypertask && hypertask task get HYCI-77 --json | python3 -c "import json,sys;print(json.load(sys.stdin)['tasks'][0]['section'])"`
  - EXPECT: `In Progress` or `AI Review`

## G9 Measurement reported with before and after
- [x] Manual: ticket and PR carry before numbers (real runs) and the measured after/recheck time
  - CHECK: `cd /home/valentin/projects/hypertask && hypertask task agent-log HYCI-77 --json | jq -r '[.activities[].text]|join("\n")' | grep -c 'within10'`
  - EXPECT: a count of 1 or more

## Evidence (run 2026-11-01)

- G1 BASED, G2 slowest=25 within10=0.57, G3 VISUAL_OK, G4 JOBS_OK 14, G5 static assertion present (CI runs the test, this host runs no tests), G6 3 shared lists match, G7 PR #2718 title/base/draft ok, G8 section AI Review, G9 agent log carries within10.
- Not met here: the real after-numbers. They come from PR #2718's own run and the next day's runs; CI Boss re-measures with ci-wait. Recorded as the recheck time in the agent lane.

## Run 2 (2026-11-01 22:2x): repair the two red checks on PR #2718

## G10 No code comment added to the pinned tests
- [ ] The ban `local/no-comments` flagged is gone from the diff
  - CHECK: `cd /home/valentin/projects/.worktrees/ci-runner-1-hyci-77 && git diff -U0 -- tests/ | rg -c '^\+.*(//|/\*)' || echo NONE`
  - EXPECT: `NONE`

## G11 Every pinned assertion names the new dependency
- [ ] No test or doc still pins visual-compare to browser-smoke
  - CHECK: `cd /home/valentin/projects/.worktrees/ci-runner-1-hyci-77 && rg -c 'visual-compare"\].needs, \["browser-build"\]' tests/browser-smoke-workflow.test.cjs tests/visual-nextjs-build-cache.test.cjs && rg -c 'visual-compare"\].needs, \["browser-smoke"\]' tests/ || echo NO_STALE`
  - EXPECT: `NO_STALE`

## G12 Docs agree with the workflow
- [ ] The browser-shard doc section no longer claims visual-compare keeps the summary wiring
  - CHECK: `cd /home/valentin/projects/.worktrees/ci-runner-1-hyci-77 && rg -c 'visual-compare. needs only the one build' docs/ci.md docs/ci/40-four-browser-shards.md && node scripts/shared-lists/build.mjs --check | tail -1`
  - EXPECT: `3 shared lists match`

## G13 The push starts CI on the new head
- [ ] A run exists for the pushed commit (green is the recheck, this host waits for nothing)
  - CHECK: `cd /home/valentin/projects/.worktrees/ci-runner-1-hyci-77 && gh api repos/hypertask-ai/hypertask/commits/$(git rev-parse HEAD)/check-runs --jq '.total_count'`
  - EXPECT: a count of 1 or more
