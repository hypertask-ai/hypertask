# Gates: YPER4-231 CI image mirrors

OWNS: .github/workflows/*.yml, scripts/premerge-local.sh, scripts/run-app-smoke-isolated.sh, scripts/app-smoke.Dockerfile, tests/mcp-transports.test.ts, GATES.md

Scope: Replace only Docker Hub CI pulls with identical official mirror images, preserve CI policy and check names, open the requested PR, prove all checks and registry pulls, and leave it unmerged. No board writes or production deploy changes.

- [x] G0: Ledger has valid, failure-capable acceptance gates
  CHECK: node /home/valentin/.agents/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=69f81179f3934636347ff01de4824d2a1f500f2d29238b9fd688f82f77d1c57b; exit=0; EXPECT=matched; output-sha256=f254776d58446cb02919a7d814a51f0c95885fcff2b01f4641e6f76babfac879; output-bytes=268; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-231; path=3cdbf7dc8e1b/28 entries

- [x] G1: CI policy and deployment contract are read before edits; all CI image paths are inventoried
  EVIDENCE: Read docs/ci-policy.yml, docs/ci.md and the canonical deployment page's source from hypertask-ai/analytics src/data/wiki/deployment.md before edits (direct URL returned Cloudflare login; source saved /tmp/yper4-231-deployment.md). Inventoried all workflow services, Docker invocations, smoke Dockerfile, e2e and test fixtures. Four active PostgreSQL suites use HTPR_PG_IMAGE; MCP transports has a Redis Docker fallback. Soketi already uses Quay. Root Dockerfile/compose are not CI inputs; optional HTPR_6509_S3_SQL and manual agent-token fixtures are not enabled by CI and remain untouched.

- [x] G2: CI images only change registry source, with a PostgreSQL mirror override and explicit pull for evidence; all tags, required check names and production deploy files are unchanged
  CHECK: python3 /tmp/yper4-231-evidence/verify.py scope
  EXPECT: SCOPE VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=b25859210756705293b8ec8cee2f768fd81eb75f89acd2aecd1d5f061b2a0a13; exit=0; EXPECT=matched; output-sha256=e92406b544656c21ec38fbab173dbea3226a931f2c5de05ab1e241e73316b09f; output-bytes=107; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-231; path=3cdbf7dc8e1b/28 entries

- [x] G3: Mirrored official images are anonymously accessible and retain the original digest family
  CHECK: python3 /tmp/yper4-231-evidence/verify.py images
  EXPECT: IMAGES VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=35ac889b893c19f4299a4a477ff954f84c051604754540bb3d3b37befb257213; exit=0; EXPECT=matched; output-sha256=2b622c3749215f84faa8e832972a02e42fdc6742e4d9b5ebd56ec063c841fbdb; output-bytes=890; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-231; path=3cdbf7dc8e1b/28 entries

- [x] G4: Requested branch, commit, PR base, title, body format and open unmerged state are correct
  CHECK: python3 /tmp/yper4-231-evidence/verify.py pr
  EXPECT: PR VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=a6b4ba79b33b84962b31b1a143f8cba9baaa6e09f5edbe03b8a86a8c24ff5240; exit=0; EXPECT=matched; output-sha256=4ad791f895f67542066568d9f4f96b0cb8b11a704ea493203f5f516b676b402f; output-bytes=106; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-231; path=3cdbf7dc8e1b/28 entries

- [ ] G5: All current-head PR checks complete successfully and AI review has no unresolved MAJOR findings
  CHECK: python3 /tmp/yper4-231-evidence/verify.py checks
  EXPECT: CHECKS VERIFIED
  EVIDENCE: pending

- [x] G6: Both Postgres-backed jobs pass and their actual logs prove pulls from the new registry
  CHECK: python3 /tmp/yper4-231-evidence/verify.py pulls
  EXPECT: PULLS VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=486b19b0e52a83d4bc64b8b185f6525fe7f3b50d6f71928d84bc932710986a5b; exit=0; EXPECT=matched; output-sha256=84d9b6a144259ae10b9947ded4726f87bc509289bcb6daacbad421c0d814b48b; output-bytes=206; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-231; path=3cdbf7dc8e1b/28 entries

- [x] G7: No board writes, merges, new secrets, or production deployment changes were performed
  EVIDENCE: Reviewed this session's commands: no vcc/board-write, merge, registry-login or secret mutation commands were run. PR #1236 remains OPEN with the hold label and autoMergeRequest null. The five-file diff contains only CI/test image sources, the existing test image override and explicit pull; root production Dockerfile/docker-compose.yml and deploy settings are untouched.

- [x] G8: Focused CI workflow regression tests pass and the diff has no whitespace errors
  CHECK: NODE_PATH=/home/valentin/projects/hypertask/node_modules node --test tests/browser-smoke-workflow.test.cjs tests/app-smoke-workflow.test.cjs tests/ci-dependency-cache.test.cjs && git diff --check 86b4f96b64 HEAD
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=31640203bab007491275f98397c925c305eaffdbb370fa9aa9fb504313113649; exit=0; EXPECT=matched; output-sha256=e0a887b2a19704f93c2bef658f04fd8d673c49896119bc89c78ed60f6ebd1fe6; output-bytes=2802; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-231; path=3cdbf7dc8e1b/28 entries

- [x] G9: All checks have settled, exact-head AI review approves, and the sole failed check is proven to use the unchanged trusted Docker Hub harness
  CHECK: python3 /tmp/yper4-231-evidence/verify.py settled
  EXPECT: SETTLED VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=b55918fb81da48f2bfc8f393ff39a63f6cab7cc532ae0d56507ecf6a031590ec; exit=0; EXPECT=matched; output-sha256=1687bfd115e2204331119c800cd54fbe804b1bc95b72bcaab4445a65d9af7c6b; output-bytes=794; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-231; path=3cdbf7dc8e1b/28 entries

ABANDON: G5 app-smoke cannot pass within the no-merge constraint: trusted production harness still pulls node:22-bookworm from Docker Hub (429 on first run, Docker Hub token 504 on retry). Required check remains red; no bypass. Owning session must resolve the trusted-harness release path. Evidence: /tmp/yper4-231-evidence/app-smoke-original.log and app-smoke-retry.log; GitHub run 37993337993 attempts 1 and 2.
