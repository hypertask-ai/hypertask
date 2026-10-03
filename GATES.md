# Gates: bounded AI Chat Manager alerts

OWNS: GATES.md, src/lib/ai/chatAlerts/**, src/lib/ai/chatStream/runStream.ts, src/lib/agentWebhooks/delivery.ts, src/lib/flags.ts, src/lib/flags/keys.ts, src/app/api/cron/native-agent-heartbeat/route.ts, src/prisma/schema.prisma, src/prisma/migrations/20261003230000_add_ai_chat_alerts/**, tests/ai-chat-alerts.test.cjs, tests/ai-chat-alerts-integration.test.cjs, tests/feature-flags.test.cjs, scripts/verify-ai-chat-alerts.cjs, docs/ai-chat-alerts.md

Scope: Implement the decided alert design for https://app.hypertask.ai/detail/project-15/6354 in this worktree only, with no board writes, push or PR. Keep the existing tracking release independent. The initial branch base is db9dc34c03378f6bb3d67e6bcaf696fbe0467f7f; origin/production moved during this session, so comparisons are pinned to that base.

- [ ] G0: The ledger has valid, failure-capable checks
  CHECK: node /home/valentin/.agents/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: pending

- [ ] G1: Rolling environment-scoped thresholds, dedupe, bounded retries, recovery and later incidents behave correctly
  CHECK: node --test tests/ai-chat-alerts.test.cjs
  EXPECT: /# fail 0/
  EVIDENCE: pending

- [ ] G2: Server gating, metadata-only sampling, existing Manager delivery and nonblocking chat integration are verified
  CHECK: node --test tests/ai-chat-alerts-integration.test.cjs
  EXPECT: /# fail 0/
  EVIDENCE: pending

- [ ] G3: The Prisma schema and additive migration enforce durable alert state with metadata-only, timezone-safe columns
  CHECK: node --test --test-name-pattern="database|retention|schema" tests/ai-chat-alerts.test.cjs && DATABASE_URL=postgresql://test:test@127.0.0.1/test npx prisma validate
  EXPECT: The schema at src/prisma/schema.prisma is valid
  EVIDENCE: pending

- [ ] G4: Changed TypeScript files have no errors and the full program adds no diagnostics compared with the initial base
  CHECK: node scripts/verify-ai-chat-alerts.cjs types
  EXPECT: Scoped typecheck passed
  EVIDENCE: pending

- [ ] G5: Changed source files pass the project linter
  CHECK: node scripts/verify-ai-chat-alerts.cjs lint
  EXPECT: Changed-file lint passed
  EVIDENCE: pending

- [ ] G6: The canonical local feature-flag gate passes for this backend-only change
  CHECK: node .github/scripts/feature-flag-gate.mjs "HTPR-6354 [FEATURE] Bounded AI Chat Manager alerts" db9dc34c03378f6bb3d67e6bcaf696fbe0467f7f HEAD
  EXPECT: No changed file matches the UI-change path filter.
  EVIDENCE: pending

- [ ] G7: Only allowed paths changed, added content has no em dashes, and existing tracking is byte-identical
  CHECK: node scripts/verify-ai-chat-alerts.cjs hygiene
  EXPECT: Diff hygiene passed
  EVIDENCE: pending

- [ ] G8: Requested local commits exist on the original branch with the required message and coauthor and no remote branch
  CHECK: node scripts/verify-ai-chat-alerts.cjs commit
  EXPECT: Requested local commit verified
  EVIDENCE: pending

- [x] G9: Domain review confirms bounded design, privacy, existing-channel reuse and session restrictions
  EVIDENCE: Reviewed policy.ts thresholds and full-window recovery; store.ts advisory transaction lock, partial unique open index, atomic attempt reservation and stale-result fencing; manager.ts stable message ID and transactionally persisted existing chat.message outbox; service.ts per-user server flag and metadata-only input; delivery.ts handled transport reports without upstream error bodies. No new prompt/reply storage or secret copy. No database connection to app data, board CLI writes, other-worktree edits, stash, push or PR were performed. Isolated PGlite executes the additive migration and real SQL, including rejection controls. Manager messages are generated metrics, not original chat bodies. Quiet-period timing follows the existing 15-minute cron. Full npx tsc reports existing errors; G4 compares the actual base and head diagnostics rather than hiding them.

- [ ] G10: Existing observability, feature-flag behavior and durable heartbeat behavior remain intact
  CHECK: node --test tests/ai-chat-observability.test.cjs tests/native-agent-heartbeat-durability.test.cjs tests/feature-flags.test.cjs
  EXPECT: /# fail 0/
  EVIDENCE: pending
