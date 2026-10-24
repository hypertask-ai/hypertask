# Gates: YPER4-227 Telegram noise

Scope: Repair production QA authentication and CI setup failures, route only actionable live-site incidents to Telegram, and open a checked production PR without merging.

- [x] G0: The ledger has valid, failure-capable acceptance checks
  CHECK: node /home/valentin/.agents/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=69f81179f3934636347ff01de4824d2a1f500f2d29238b9fd688f82f77d1c57b; exit=0; EXPECT=matched; output-sha256=c674e9a7924f11b4450b0858a6311128fc83242165b1ccdac18dc73bcaca7e45; output-bytes=504; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-227; path=3cdbf7dc8e1b/28 entries

- [x] G1: QA authentication source, minting, expiry and safe renewal are evidenced without exposing credentials
  EVIDENCE: SMOKE_SESSION_STATE was a manually exported QA browser state, uploaded with gh secret set. src/lib/auth/session.ts signs a fixed-expiry ht_session (SESSION_TTL_SECONDS = 6048000, 70 days); the frozen state also carries expiring client cookies. QA-only POST /api/auth/qa-login already pins user 985 and renews server/client cookies. gh secret list confirmed QA_LOGIN_EMAIL and QA_LOGIN_PASSWORD already exist. qa-session-renewal.test.cjs proves fresh context, fixed QA identity, rejection of user 6 and other identities, and private state. No signing secret or credential value was accessed or added. Live local proof is unavailable because the documented local QA credential file does not exist; no new GitHub secret or human renewal step is required.

- [x] G2: Unrunnable smoke and CI setup failures send no Telegram, real live-site failures and rollback still alert, and repeated causes are deduplicated daily
  CHECK: node --test tests/telegram-alerts.test.cjs tests/qa-session-renewal.test.cjs
  EXPECT: fail 0
  EVIDENCE: automatic-evidence=v1; definition-sha256=5543086f56a21b50cc65097e51c9b5c8e96ba659acdb5cc97ca03530cb689e51; exit=0; EXPECT=matched; output-sha256=1efe433bc12d687b4595992e850edce21292f5561dbafb4e12736235dc69714a; output-bytes=3480; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-227; path=3cdbf7dc8e1b/28 entries

- [x] G3: Both specified CI logs identify cause B and the fix or non-Telegram routing addresses that cause
  EVIDENCE: gh run view --log-failed for 37949610394 and 37953668816 saved to /tmp/yper4-227-ci-*.log. First run: 29 failures, including unresolved welcome-email alias in demo-login-own-board and missing project.findFirst through the unstubbed native login-board resolver. Second run: only the native-hook board-resolver mock failure. Production base dd39d04700 already contains both repairs; G5 reruns both suites. The workflow parser now names Node spec and TAP failures and routes all unit/setup failures to infrastructure evidence, never Telegram.

- [x] G4: Repository lint and UI enforcement pass
  CHECK: npm run lint && node --test tests/ui-patterns.test.cjs
  EXPECT: fail 0
  EVIDENCE: automatic-evidence=v1; definition-sha256=9bdc1a1903eee88d367147ef97d74496e7b1a49760c9c6247306f551f245959a; exit=0; EXPECT=matched; output-sha256=75ffe40ea7fddba11ad76be16819641d142fc39f8bcee28db07add954e2ae883; output-bytes=10385; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-227; path=3cdbf7dc8e1b/28 entries

- [x] G5: Workflow and existing production-health regression tests pass
  CHECK: node --test tests/prod-health*.test.cjs tests/prod-smoke-alarm*.test.cjs tests/postdeploy-browser-smoke.test.cjs tests/api-reachability-check.test.cjs tests/ci-*.test.cjs tests/demo-login-own-board.test.cjs tests/htpr-7025-welcome-email.test.cjs tests/glm-qa-dispatch.test.cjs tests/production-gate.test.cjs tests/style-guide-lint-pipeline.test.cjs tests/app-smoke-workflow.test.cjs tests/browser-smoke-workflow.test.cjs tests/parity-contract.test.cjs tests/posthog-error-workflow.test.cjs tests/emergency-rollback.test.cjs tests/core-actions-smoke-script.test.cjs
  EXPECT: fail 0
  EVIDENCE: automatic-evidence=v1; definition-sha256=3d50cb37b586d7cda7721c0b44d26876c88afbe494676184b54d68b023b68db5; exit=0; EXPECT=matched; output-sha256=fb5357f4a676180f264d37966e9a84c40ee09890b4ae8f45cb71e54ed1cd6345; output-bytes=53897; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-227; path=3cdbf7dc8e1b/28 entries

- [x] G6: The requested commit and unmerged production PR exist with the required title and body
  CHECK: node /tmp/yper4-227-verify-pr.cjs
  EXPECT: PR contract verified
  EVIDENCE: automatic-evidence=v1; definition-sha256=12a52567c2ec9027c3e5f040b82d31ae6511f5c3d9064c257a0d13da0b6e20b1; exit=0; EXPECT=matched; output-sha256=e543bd5a0ad633bbbbf0c35f48f4343f5edf7de4c5b099c06f81e54b754c5bc7; output-bytes=21; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-227; path=3cdbf7dc8e1b/28 entries

- [x] G7: PR checks have settled and AI-review MAJOR findings are fixed within at most two rounds
  CHECK: node /tmp/yper4-227-verify-checks.cjs
  EXPECT: ALL CHECKS VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=0fe08d4b3184ee7fd07f3ed1c287d159fe50c9c48024df89c25bb6d8be3ee05f; exit=0; EXPECT=matched; output-sha256=833dbbccc2f57b7e588404db1fb660b629ea96ffb2194732933432dda3e5e1b0; output-bytes=148; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-yper4-227; path=3cdbf7dc8e1b/28 entries

- [x] G8: Final diff is limited to this ticket, credential-safe, and the worktree originated from fetched origin/production
  EVIDENCE: Fresh git fetch origin production preceded git worktree add -b yper4-227-telegram-noise /home/valentin/projects/hypertask-yper4-227 origin/production at dd39d04700833415ff1f0d566383b5a590ecc550. Original checkout untracked files were untouched. git diff --check passed; diff reviewed for QA identity, notification paths, rollback authority, secret exposure, and daily serialization. No new production credentials, runner, preview deployment, branch rewrite, stash or merge. GATES.md remains local acceptance evidence. Simplification review found no additional change necessary.
