# Gates: bounded AI Chat Manager alerts

OWNS: GATES.md, src/lib/ai/chatAlerts/**, src/lib/ai/chatStream/runStream.ts, src/lib/agentWebhooks/delivery.ts, src/lib/flags.ts, src/lib/flags/keys.ts, src/app/api/cron/native-agent-heartbeat/route.ts, src/prisma/schema.prisma, src/prisma/migrations/20261003230000_add_ai_chat_alerts/**, tests/ai-chat-alerts.test.cjs, tests/ai-chat-alerts-integration.test.cjs, tests/feature-flags.test.cjs, scripts/verify-ai-chat-alerts.cjs, docs/ai-chat-alerts.md

Scope: Implement the decided alert design for https://app.hypertask.ai/detail/project-15/6354 in this worktree only, with no board writes, push or PR. Keep the existing tracking release independent. The initial branch base is db9dc34c03378f6bb3d67e6bcaf696fbe0467f7f; origin/production moved during this session, so comparisons are pinned to that base.

- [x] G0: The ledger has valid, failure-capable checks
  CHECK: node /home/valentin/.agents/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=69f81179f3934636347ff01de4824d2a1f500f2d29238b9fd688f82f77d1c57b; exit=0; EXPECT=matched; output-sha256=497e1b1fd83aa8c97730b46891c668bfc53799ce4cdaa54b7d44728bf3aca6e2; output-bytes=150; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6354; path=fd5351737ae0/31 entries

- [x] G1: Rolling environment-scoped thresholds, dedupe, bounded retries, recovery and later incidents behave correctly
  CHECK: node --test tests/ai-chat-alerts.test.cjs
  EXPECT: /# fail 0/
  EVIDENCE: automatic-evidence=v1; definition-sha256=19ce4bbd6e5cdf13e4765973243947e08ba3cdab17270c329e5fa404701f6dda; exit=0; EXPECT=matched; output-sha256=a70f3302192380a7a071169a6bfc1eeb9d4ee2eadee364ecbd25d7a59b0b9fc4; output-bytes=2896; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6354; path=fd5351737ae0/31 entries

- [x] G2: Server gating, metadata-only sampling, existing Manager delivery and nonblocking chat integration are verified
  CHECK: node --test tests/ai-chat-alerts-integration.test.cjs
  EXPECT: /# fail 0/
  EVIDENCE: automatic-evidence=v1; definition-sha256=15200c0b0e4d5aef3a6ca2c0b218f69bfc6d6e8c90a2e26c653e291a118de77c; exit=0; EXPECT=matched; output-sha256=eb0d29efcdc1e185ba9b259b6f31a1fb3ac9cdf585a85d071761be8939e7752e; output-bytes=2782; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6354; path=fd5351737ae0/31 entries

- [x] G3: The Prisma schema and additive migration enforce durable alert state with metadata-only, timezone-safe columns
  CHECK: node --test --test-name-pattern="database|retention|schema" tests/ai-chat-alerts.test.cjs && DATABASE_URL=postgresql://test:test@127.0.0.1/test npx prisma validate
  EXPECT: The schema at src/prisma/schema.prisma is valid
  EVIDENCE: automatic-evidence=v1; definition-sha256=7adcc7acc807e46a0a29ad91e614f2099bb877cf0ae7ec67590e2795c333d021; exit=0; EXPECT=matched; output-sha256=bec1b27681471a28319b6bcd916058389b330c732bb4fac32e2911ebfdbc66bb; output-bytes=1773; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6354; path=fd5351737ae0/31 entries

- [x] G4: Changed TypeScript files have no errors and the full program adds no diagnostics compared with the initial base
  CHECK: node scripts/verify-ai-chat-alerts.cjs types
  EXPECT: Scoped typecheck passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=36d4c9c7e98a61f9dff6de46e8c6873348d1a006dbc5ad857d412fb90e51c14e; exit=0; EXPECT=matched; output-sha256=cec863c4dfd67ac3ae4e67e71d45fbbc0448fa2de5f768e1d0ac31f1e6a8d49a; output-bytes=89; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6354; path=fd5351737ae0/31 entries

- [x] G5: Changed source files pass the project linter
  CHECK: node scripts/verify-ai-chat-alerts.cjs lint
  EXPECT: Changed-file lint passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=8c7f7ec7cf6b4e86b9b56af0c833a2a013cae987859974660e63dd3724904070; exit=0; EXPECT=matched; output-sha256=776ae39a66f8b30d75083008bc56834430b6e9703789b59195da104067fa00de; output-bytes=2614; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6354; path=fd5351737ae0/31 entries

- [x] G6: The canonical local feature-flag gate passes for this backend-only change
  CHECK: node .github/scripts/feature-flag-gate.mjs "HTPR-6354 [FEATURE] Bounded AI Chat Manager alerts" db9dc34c03378f6bb3d67e6bcaf696fbe0467f7f HEAD
  EXPECT: No changed file matches the UI-change path filter.
  EVIDENCE: automatic-evidence=v1; definition-sha256=ae6b3e443ef35e1753ae67239872c240b357973979d43ec8391d5d4dccd980ad; exit=0; EXPECT=matched; output-sha256=829d9b1d7d72378adab577cfa6ec9210d1c300c0dfa5898fd2cd88c9222c16c9; output-bytes=51; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6354; path=fd5351737ae0/31 entries

- [x] G7: Only allowed paths changed, added content has no em dashes, and existing tracking is byte-identical
  CHECK: node scripts/verify-ai-chat-alerts.cjs hygiene
  EXPECT: Diff hygiene passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=5285579c815f0dbe22f8a11d4ada3fbe72ba9279f996f563424f53a8f0f40a00; exit=0; EXPECT=matched; output-sha256=53a047f736c390254776ab5d889d763c97f3542245ac12036ce228d7a83688a3; output-bytes=20; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6354; path=fd5351737ae0/31 entries

- [x] G8: Requested local commits exist on the original branch with the required message and coauthor and no remote branch
  CHECK: node scripts/verify-ai-chat-alerts.cjs commit
  EXPECT: Requested local commit verified
  EVIDENCE: automatic-evidence=v1; definition-sha256=8664c984ac2d69428f3a2c94f7b7fb24de101bae55ecdb742e7b5520be17b2ec; exit=0; EXPECT=matched; output-sha256=7a7b6416a543173305eb986badc9e6b25c72fb7770a5ebb54c44429ec2a2dec1; output-bytes=32; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6354; path=fd5351737ae0/31 entries

- [x] G9: Domain review confirms bounded design, privacy, existing-channel reuse and session restrictions
  EVIDENCE: Reviewed policy.ts thresholds and full-window recovery; store.ts advisory transaction lock, partial unique open index, atomic attempt reservation and stale-result fencing; manager.ts stable message ID and transactionally persisted existing chat.message outbox; service.ts per-user server flag and metadata-only input; delivery.ts handled transport reports without upstream error bodies. No new prompt/reply storage or secret copy. No database connection to app data, board CLI writes, other-worktree edits, stash, push or PR were performed. Isolated PGlite executes the additive migration and real SQL, including rejection controls. Manager messages are generated metrics, not original chat bodies. Quiet-period timing follows the existing 15-minute cron. Full npx tsc reports existing errors; G4 compares the actual base and head diagnostics rather than hiding them.

- [x] G10: Existing observability, feature-flag behavior and durable heartbeat behavior remain intact
  CHECK: node --test tests/ai-chat-observability.test.cjs tests/native-agent-heartbeat-durability.test.cjs tests/feature-flags.test.cjs
  EXPECT: /# fail 0/
  EVIDENCE: automatic-evidence=v1; definition-sha256=112f4371540d40390d5f7ad6e4b0b472ff45e2d5b7be602bed16b223854e0541; exit=0; EXPECT=matched; output-sha256=eb2825be3915171d7de37445c4f724148956162934f7db35ed612936626c5d32; output-bytes=8219; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6354; path=fd5351737ae0/31 entries
