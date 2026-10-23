# Gates: YPER4-610

OWNS: GATES.md, .claude/skills/maintain-verification-skill/**, .claude/skills/INDEX.md, .claude/skills/verify-qa/SKILL.md, .github/workflows/feature-map-weekly.yml, docs/ci.md, docs/ci-policy.yml

Scope: Build offline feature-map checking, bounded weekly source audits, durable user units and documented pstack upkeep without pushing or board/database access.

- [x] G1: Offline checker and weekly-runner node:test fixtures pass through the permitted direct script invocation
  CHECK: node .claude/skills/maintain-verification-skill/scripts/feature-map-check.test.mjs
  EXPECT: fail 0
  EVIDENCE: automatic-evidence=v1; definition-sha256=11bf25bba7e16d19c213ed6359c127798d2d9d44fda4af71a57af566448b5901; exit=0; EXPECT=matched; output-sha256=417b92f4c3d99d191bc00493354ed997b915d11ab6fb3a182924f760e52abd3e; output-bytes=2105; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-610; path=707812924eff/21 entries

The original node --test command is killed by the host heavy-guard (exit 137), which rejects all Hypertask --test processes after five seconds. The direct script invocation executes the identical node:test cases and assertions without changing that host guard. GitHub runs the requested --test command.

- [x] G2: Bash and Node syntax is valid
  CHECK: bash -n .claude/skills/maintain-verification-skill/scripts/maintain-verification-weekly && node --check .claude/skills/maintain-verification-skill/scripts/feature-map-check.mjs && node --check .claude/skills/maintain-verification-skill/scripts/maintain-verification-state.mjs && node --check .claude/skills/maintain-verification-skill/scripts/feature-map-check.test.mjs && echo SYNTAX_OK
  EXPECT: SYNTAX_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=20c1ad6d692cdcf68274da3ac52e54972f5e2d5b711669d14c6723637cb060ad; exit=0; EXPECT=matched; output-sha256=998ccf616845fbd499cb9af01f47e877a7b5e6c6982e4098016424acaf9182d1; output-bytes=10; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-610; path=707812924eff/21 entries

- [x] G3: Real-checkout findings captured without editing feature-map pages
  EVIDENCE: Node 24.5.0 checker exited 1 with exactly the two findings recorded below; git diff --exit-code -- .claude/skills/verify-qa/reference/feature-map returned 0. No area pages were edited.

- [x] G4: Skill attribution, workflow policy, durable timer and runner contract reviewed
  EVIDENCE: cmp proved LICENSE byte-identical to installed pstack MIT text. First body line contains the exact required attribution. Reviewed source-only prompts, two-helper batches/eight-page cap, single retry, timeout/termination, durable install and legacy-timer retirement, load hold, backlog and pending drift, HTML escaping/recipes/citations and once-weekly RUNNER 8 filing. The 19 offline fixtures cover these contracts including policy/action manifest assertions; no repo suite or live installation was run.

- [x] G5: Only requested-worktree changes committed with required trailers and no forbidden actions
  EVIDENCE: Initial worktree was clean on yper4-610-feature-map. Inspected staged paths and logical commits; only the declared worktree-owned files are included. Both YPER4-610 commit messages end with the exact requested Co-Authored-By and Claude-Session trailers. Final git status and commit list rechecked after the documentation commit. No push, PR, real board writes, database access, app tests/builds, package install, helper sessions or live timer installation occurred; fixtures used only temporary local stubs.

## Exact real-checkout output (exit 1)

```text
- INDEX.md: unindexed page: search.md
- login.md: missing path: src/middleware.ts
```

## Verification environment

Node 24.5.0 from the already installed Cursor runtime was placed on PATH for the fixture and syntax gates. No runtime was installed. The host heavy-guard kills full `node --test` invocations (exit 137); it was not disabled or modified. The same 19 node:test fixtures execute successfully with direct `node <new-test-file>`. GitHub retains the requested `node --test` invocation.
