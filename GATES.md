# Gates: browser smoke without an ungenerated Prisma client

Scope: Fix the post-deploy smoke failure for https://app.hypertask.ai/detail/project-4060/227, preserve QA login and Telegram behavior, open a verified PR, and do not merge.

- [x] G0: The ledger declares valid acceptance gates
  CHECK: node /home/valentin/.agents/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=69f81179f3934636347ff01de4824d2a1f500f2d29238b9fd688f82f77d1c57b; exit=0; EXPECT=matched; output-sha256=651d376da9258c7361dab6eab597e455ed92b643c016b570616cfda581c35ce9; output-bytes=150; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-227-smoke-prisma; path=3cdbf7dc8e1b/28 entries

- [x] G1: The failed run and complete import chain identify why Prisma loads in browser smoke
  EVIDENCE: Run 37971179667 head 776ae0e3475119602d47502d905dfc3b6e045e0d, smoke job 113959852592. Full job log /tmp/yper4-227-smoke.log:460-466 confirms QA user 985 followed by missing .prisma/client/default through layout-lock.spec.ts:13, flags.ts:5, prisma.ts:7. Failed-only log omits continue-on-error smoke output. npm ci has no generate hook; isolated CI browser-smoke already runs prisma generate. Regression test failed before fix because it observed only npm ci. Canonical wiki redirects to Cloudflare Access; read docs/ci-policy.yml and docs/ci.md fallback.

- [x] G2: Relevant smoke regression tests, lint, and typecheck pass
  CHECK: npm exec --yes --package=node@24 -- node --test tests/postdeploy-browser-smoke.test.cjs tests/qa-session-renewal.test.cjs tests/layout-lock.test.cjs tests/ui-patterns.test.cjs && npm exec --yes --package=node@24 -- npm run lint && npm exec --yes --package=node@24 -- npm run typecheck
  EXPECT: /ℹ fail 0[\s\S]*tsc --noEmit/
  EVIDENCE: automatic-evidence=v1; definition-sha256=379d348c666f1d004169910ed799f97f59f2e7a8b6f4102f855927a08c72ea93; exit=0; EXPECT=matched; output-sha256=dfff3fd612d69354a74f231eb96caa40aa74ce2d5288d7fea9fbb826c2c6a0ae; output-bytes=12755; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-227-smoke-prisma; path=3cdbf7dc8e1b/28 entries

- [x] G3: QA-only login and setup failure classification preserve Telegram noise suppression
  CHECK: npm exec --yes --package=node@24 -- node --test tests/qa-session-renewal.test.cjs tests/telegram-alerts.test.cjs tests/prod-smoke-alarm-workflow.test.cjs tests/prod-smoke-alarm.test.cjs
  EXPECT: ℹ fail 0
  EVIDENCE: automatic-evidence=v1; definition-sha256=4b774a3c34dfa23b827bc544f4e957e0ed4da54171258da48b0037b0e06d0bf8; exit=0; EXPECT=matched; output-sha256=1d8683cb16a35946508fa257192613cb3651733a512d0eeb1d412dd8fcfe6ec4; output-bytes=2947; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-227-smoke-prisma; path=3cdbf7dc8e1b/28 entries

- [x] G4: The branch starts at fetched origin/production and contains only this session's intended change
  CHECK: node /tmp/yper4-227-smoke-prisma-evidence/verify.mjs git
  EXPECT: branch and minimal diff verified
  EVIDENCE: automatic-evidence=v1; definition-sha256=82c973c277974bb12e6c573e6a73dfed7cb2fc04e755598264d90504172f9371; exit=0; EXPECT=matched; output-sha256=ccafeade6caa54c00196b99c207f8b025cac814c297316a62504e40026365b3a; output-bytes=33; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-227-smoke-prisma; path=3cdbf7dc8e1b/28 entries

- [x] G5: The unmerged PR targets production with the requested title, commit, and complete body
  CHECK: node /tmp/yper4-227-smoke-prisma-evidence/verify.mjs pr
  EXPECT: PR contract and unmerged state verified
  EVIDENCE: automatic-evidence=v1; definition-sha256=27d389f29e7b2cd8bb3d9c6d6814b9b8e1aab049ecb7b215844187f53fa8aecd; exit=0; EXPECT=matched; output-sha256=4c0a33f5b013d3d8772903cb604e1dbd3adc4811ef7b27f9749e705d1f8c16fd; output-bytes=40; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-227-smoke-prisma; path=3cdbf7dc8e1b/28 entries

- [x] G6: Required PR checks pass and exact-head AI review approves without MAJOR findings
  CHECK: node /tmp/yper4-227-smoke-prisma-evidence/verify.mjs checks
  EXPECT: /all [1-9][0-9]* required checks passed; exact-head AI review approved/
  EVIDENCE: automatic-evidence=v1; definition-sha256=f1f6c332e9af2e2e7f5c3dd2109339bc49b78be320bbaf670b53f7e6505928b4; exit=0; EXPECT=matched; output-sha256=700a5b2342dfe792363c9a4cc084ffc749ee32042b0ebe16a7a2e22067475014; output-bytes=61; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-227-smoke-prisma; path=3cdbf7dc8e1b/28 entries

- [x] G7: The branch smoke is exercised through workflow_dispatch if supported, with its actual result recorded
  CHECK: node /tmp/yper4-227-smoke-prisma-evidence/verify.mjs dispatch
  EXPECT: branch dispatch outcome verified: Prisma fixed; unavailable QA fixture still fails smoke
  EVIDENCE: automatic-evidence=v1; definition-sha256=9c317411498cfd2be59bff9f5194b5140431d6a639dda61506d1edb87cf04ef0; exit=0; EXPECT=matched; output-sha256=909fbff96fa28b114f336b3d8b6ce9a9d4b46d59f62081c5f4de0f8e0edc66b3; output-bytes=89; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-227-smoke-prisma; path=3cdbf7dc8e1b/28 entries

- [x] G8: The PR remains unmerged with auto-merge off at handoff
  CHECK: node /tmp/yper4-227-smoke-prisma-evidence/verify.mjs pr
  EXPECT: PR contract and unmerged state verified
  EVIDENCE: automatic-evidence=v1; definition-sha256=27d389f29e7b2cd8bb3d9c6d6814b9b8e1aab049ecb7b215844187f53fa8aecd; exit=0; EXPECT=matched; output-sha256=4c0a33f5b013d3d8772903cb604e1dbd3adc4811ef7b27f9749e705d1f8c16fd; output-bytes=40; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-227-smoke-prisma; path=3cdbf7dc8e1b/28 entries

- [x] G9: The Desktop and Mobile smoke specs load with generated Prisma and no database credentials
  CHECK: SMOKE_BASE_URL=https://app.hypertask.ai npm exec --yes --package=node@24 -- npx playwright test -c playwright.config.smoke.ts --project Desktop --project Mobile --list
  EXPECT: /Total: [1-9][0-9]* tests in 2 files/
  EVIDENCE: automatic-evidence=v1; definition-sha256=c97a47089fa1d73180462987fb7ef1053a293d31b23b149e45960216d5cd2719; exit=0; EXPECT=matched; output-sha256=5ff7cde74adfb10c35ef0f194a3b697c58a67cc5352a75c55165de3e470675b4; output-bytes=3406; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-227-smoke-prisma; path=3cdbf7dc8e1b/28 entries
