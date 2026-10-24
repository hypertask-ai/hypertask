# Gates: YPER4-696 expose PR smoke flakes

OWNS: playwright.config.smoke.ts, tests/smoke-retries.test.cjs, docs/ci.md, GATES.md

Scope: PR smoke projects get zero retries, production health retains one retry, and the held production-target PR carries proof and a first-20-run reporting handoff. No board writes, merges, flags, app servers, builds, or full-suite runs.

Breaks if: changing the shared config removes production's second attempt and changes automatic rollback decisions, or any PR project can still hide an initial failure.

- [x] G1: Every resolved PR project has zero retries; post-deploy Desktop/Mobile retain one retry; the test rejects the old global retry policy
  CHECK: NODE_PATH=/home/valentin/projects/hypertask/node_modules node --test tests/smoke-retries.test.cjs
  EXPECT: fail 0
  EVIDENCE: automatic-evidence=v1; definition-sha256=3281ff2cde280b8281c096db4aeb67da56abac8f74969bf26cf89808958b6b4f; exit=0; EXPECT=matched; output-sha256=5aab9b9578fd62f10f6f0bee8e1a66b646c475802b4e2da96d2e663922f915ac; output-bytes=567; shell=/bin/sh; cwd=/home/valentin/projects/.worktrees/poteto-YPER4-696; path=d01735fb690d/13 entries

- [x] G2: Existing smoke workflow and post-deploy regression checks remain green
  CHECK: NODE_PATH=/home/valentin/projects/hypertask/node_modules node --test tests/browser-smoke-workflow.test.cjs tests/postdeploy-browser-smoke.test.cjs
  EXPECT: fail 0
  EVIDENCE: automatic-evidence=v1; definition-sha256=eb4e2f6d0ee70b7f95a656f76f3a8b0e9f8f5d698885c84254c35e8b918b4b5b; exit=0; EXPECT=matched; output-sha256=63f74b80f31a4a7c6cb09739a110344c3db2ccd4970d759e499824ad13e43134; output-bytes=7333; shell=/bin/sh; cwd=/home/valentin/projects/.worktrees/poteto-YPER4-696; path=d01735fb690d/13 entries

- [x] G3: The focused change passes diff whitespace validation
  CHECK: git diff --check origin/production
  EXPECT: /^$/
  EVIDENCE: automatic-evidence=v1; definition-sha256=4c19cabb67add4f96f042fdf728af19173e0432efe5ad442819a23f892a77eb8; exit=0; EXPECT=matched; output-sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855; output-bytes=0; shell=/bin/sh; cwd=/home/valentin/projects/.worktrees/poteto-YPER4-696; path=d01735fb690d/13 entries

- [ ] G4: One held PR targets production with a repo-compliant INFRA title, ticket URL, rationale, test proof and reporting handoff
  CHECK: gh pr view ceo/YPER4-696 --repo hypertask-ai/hypertask --json url,title,baseRefName,labels,body,state | node -e 'const a=require("node:assert/strict");let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const p=JSON.parse(s);a.equal(p.state,"OPEN");a.equal(p.baseRefName,"production");a.match(p.title,/^YPER4-696 \[INFRA\] /);a.ok(p.labels.some(l=>l.name==="hold"));for(const text of ["https://app.hypertask.ai/detail/project-4060/696","37 passed","zero retries","first 20","Poteto"])a.ok(p.body.includes(text),text);console.log("PR handoff verified",p.url)})'
  EXPECT: PR handoff verified
  EVIDENCE: pending

- [ ] G5: Report flaky tests from the first 20 PR browser-smoke runs after adoption
  EVIDENCE: pending

ABANDON: G5 Post-adoption runs cannot exist before this PR is merged; this helper is explicitly forbidden to merge. Poteto must collect the first 20 completed PR browser-smoke runs after merge, preserving failed and cancelled runs rather than calling them green, and report named failures and any same-SHA rerun recoveries. With retries zero, Playwright retry-pass counts are necessarily zero and must not be presented as proof of no flakes.

## Review notes

- Red control before the config change: `NODE_PATH=/home/valentin/projects/hypertask/node_modules nice -n 19 node --test tests/smoke-retries.test.cjs` exited 1; Desktop reported `['failed', 'passed']` where the PR assertion required `['failed']`. The production positive control passed.
- Final targeted verification: `nice -n 19 node --test tests/smoke-retries.test.cjs tests/browser-smoke-workflow.test.cjs tests/postdeploy-browser-smoke.test.cjs`: 37 passed, 0 failed. Probes use the actual Playwright retry runner with browser-free tests; no browser, build, server, or live account is involved.
- Focused lint: `nice -n 19 node_modules/.bin/eslint tests/smoke-retries.test.cjs playwright.config.smoke.ts`: exit 0. An initial attempt without worktree dependency resolution failed to load ESLint; a gitignored node_modules symlink to the existing installation fixed resolution without installing anything or editing the main checkout.
- Simplification/no-comments self-review: removed three obsolete retry-policy comment lines; added no code comments, suppressions, compatibility paths, or extra runtime abstractions. No separate simplify commit was needed. No nested reviewer was delegated. Both new tests execute real Playwright scheduling and assert literal attempt outcomes; undefined imports cannot satisfy them.
- Title follows the repository-required `YPER4-696 [INFRA] ...` format rather than the requested colon-only form, which the title gate rejects.
