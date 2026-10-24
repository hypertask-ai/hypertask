# Gates: YPER4-680 stale-branch app-smoke

Scope: Keep app-smoke migrations and seed Prisma client compatible on stale candidates, prove the regression, and hand off one hold-labeled PR without merging or board writes.

- [x] G1: Real PostgreSQL reproduces production-client P2022 and accepts the candidate client; the smoke script selects that client on stale and matching-cache paths
  CHECK: HT_REQUIRE_PG_TESTS=1 node_modules/.bin/node24 --test --test-reporter=tap tests/app-smoke-schema.test.cjs tests/app-smoke-prisma.test.cjs
  EXPECT: # fail 0
  EVIDENCE: automatic-evidence=v1; definition-sha256=854ce9d3b34a16f6442941380c6908f9c39f93279f6fc333d0258f8d544b36bd; exit=0; EXPECT=matched; output-sha256=7867930fef3d85ddaeba00699e820e178a167280c0046eb0c6b74d49df65a2a2; output-bytes=912; shell=/bin/sh; cwd=/home/valentin/projects/.worktrees/poteto-YPER4-680; path=d01735fb690d/13 entries

- [x] G2: Existing smoke, CI policy, image, dependency-cache, core-action and UI-pattern checks still pass
  CHECK: node_modules/.bin/node24 --test --test-reporter=tap tests/app-smoke-workflow.test.cjs tests/ci-dependency-cache.test.cjs tests/ci-images.test.cjs tests/ci-image-sources.test.cjs tests/ci-coverage-nightly.test.cjs tests/core-actions-smoke-script.test.cjs tests/ui-patterns.test.cjs
  EXPECT: # fail 0
  EVIDENCE: automatic-evidence=v1; definition-sha256=9075ffc7cecb922a35883cff2e788edb47de872472ee16446013076ec302d5fa; exit=0; EXPECT=matched; output-sha256=16d9ff9691a549d42a6d428591c27d09d7b55fbf44f29205c019e1eaa37e6ea5; output-bytes=13390; shell=/bin/sh; cwd=/home/valentin/projects/.worktrees/poteto-YPER4-680; path=d01735fb690d/13 entries

- [x] G3: Shell syntax and staged or unstaged whitespace checks pass
  CHECK: bash -n scripts/run-app-smoke-isolated.sh && git diff --check && git diff --cached --check
  EXPECT: /^$/
  EVIDENCE: automatic-evidence=v1; definition-sha256=97f88f7ebfd264c112f4d4ec9d65b6bda5a659c4cada93fdbd5d06babda4cffb; exit=0; EXPECT=matched; output-sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855; output-bytes=0; shell=/bin/sh; cwd=/home/valentin/projects/.worktrees/poteto-YPER4-680; path=d01735fb690d/13 entries

- [x] G4: Root cause and choice are explained in one production-targeted, hold-labeled, unmerged PR with local proof and only ticket-scoped changes
  EVIDENCE: Verified PR https://github.com/hypertask-ai/hypertask/pull/2120 via gh pr view: OPEN, production base, ceo/YPER4-680 head, hold label, mergedAt null, autoMergeRequest null. Body contains ticket link, root cause, option 1 rationale and all local proof. Reviewed exactly six scoped files: GATES.md, docs/ci.md, scripts/run-app-smoke-isolated.sh and the three app-smoke tests.

- [x] G5: Repository lint passes
  CHECK: PATH="$PWD/node_modules/.bin:$PATH" npm run lint && printf 'repository lint passed\n'
  EXPECT: repository lint passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=8693d63d753ed561127af5c498739bcdfdbcbb506f3c6eaef30fc566af5dfbec; exit=0; EXPECT=matched; output-sha256=7b98a76a76c6c317d7ef36bbd135743a89f63e2f6afaa4498065221ed74205b0; output-bytes=7843; shell=/bin/sh; cwd=/home/valentin/projects/.worktrees/poteto-YPER4-680; path=d01735fb690d/13 entries

- [x] G6: Fresh repository TypeScript check passes
  CHECK: PATH="$PWD/node_modules/.bin:$PATH" npm run typecheck && printf 'repository typecheck passed\n'
  EXPECT: repository typecheck passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=94d13bb1fa0039a48e05436802fe94f559f1e53eac99a51f30513ab44011a801; exit=0; EXPECT=matched; output-sha256=12d40ab49452c003d13f1e53f7647f0042a231e4d8ead9133ac9298b8953752d; output-bytes=337; shell=/bin/sh; cwd=/home/valentin/projects/.worktrees/poteto-YPER4-680; path=d01735fb690d/13 entries

## Before/after and review

- Before the fix, `node --test tests/app-smoke-schema.test.cjs` failed both runtime cases with `seed and migrations must use the same generated Prisma client` (2 failures). After the fix both pass.
- The PostgreSQL regression generates two real clients, deploys only the older candidate migration, asserts the newer client fails with P2022, and asserts an insert succeeds using the candidate client.
- The Docker-boundary regression executes the real smoke shell script with a recording transport, stopping at seeding to avoid a production build. It checks client generation, migration/seed ordering, shared client mounts, production-pinned seed, and isolation. Full Next build/core-action app-smoke remains GitHub verification; this is not a local end-to-end claim.
- Simplify/no-comments self-review: no new production helper, explanatory comments, lint/type suppressions or fallback guards; obsolete seed-only runtime removed. No separate simplification commit needed. No additional helpers delegated.
- No board writes, merge, or feature-flag changes. Work stays in this session's worktree.

- Local setup: Node v24.22.0 from the existing Node 24 container image; isolated worktree dependency copy. Initial typecheck found the copied Prisma client was stale, so regenerated it from this checkout before rerunning. Initial full lint exceeded the gate runner’s 120-second limit; rerun allows 600 seconds. No lint bypasses.

- The first commit was refused because the scanner checks entire staged files and detected two pre-existing, fixed disposable-DB URLs in the smoke script. Added only the documented line-scoped `trufflehog:ignore` annotations to those non-secret fixtures; scanner remains enabled. The new PostgreSQL fixture uses a fresh random password per run.
