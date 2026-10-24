# Gates: YPER4-677 test inventory

OWNS: GATES.md, scripts/test-inventory/**, docs/test-inventory/**

Scope: Inventory only for https://app.hypertask.ai/detail/project-4060/677; no existing test, workflow, flag, app or board changes; open a hold PR and never merge.

- [x] G1: Classifier fixture checks distinguish behaviour, source-text and mixed tests, preserve mandatory KEEP rules, and reject incomplete evidence.
  CHECK: node scripts/test-inventory/inventory.mjs --self-test && python3 scripts/test-inventory/collect.py --self-test && node --test tests/test-inventory.test.cjs && node_modules/.bin/eslint scripts/test-inventory/inventory.mjs
  EXPECT: collector self-test passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=be7cca3432ff47df939bb04b8aedc3ccdf0d96d99e08772d13226ef56e3548ea; exit=0; EXPECT=matched; output-sha256=c25799736a5030d2b6a220689708aef6cde767979a14134fbf6b6d91abf124aa; output-bytes=573; shell=/bin/sh; cwd=/home/valentin/projects/.worktrees/poteto-YPER4-677; path=d01735fb690d/13 entries

- [x] G2: Committed inventory reproduces byte-for-byte from the pinned git tree and committed sanitized git/GitHub evidence, with one row per discovered test and reconciled class timing totals.
  CHECK: node scripts/test-inventory/inventory.mjs --check
  EXPECT: inventory reproduction passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=6c4a460b1e8f4e1e51a53cceed9a9203c6b5c762306d61486e768b1a7dea9f7c; exit=0; EXPECT=matched; output-sha256=4424362954eb7b75f5ad3b4f67515c61c42602e246bf8b42c33083570b7ec784; output-bytes=30; shell=/bin/sh; cwd=/home/valentin/projects/.worktrees/poteto-YPER4-677; path=d01735fb690d/13 entries

- [x] G3: Existing tests, app code, workflows and flags are unchanged; only owned inventory artifacts are in the diff.
  CHECK: node scripts/test-inventory/inventory.mjs --check-scope
  EXPECT: inventory scope passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=82c646113a3c6456933c30a498a8b5f712cb56977fd29901bebf3978740e166d; exit=0; EXPECT=matched; output-sha256=1a2df695db86df9dfe9cdd0dbada74648e565b9b312e7994cac7cdb29b8ca4e0; output-bytes=23; shell=/bin/sh; cwd=/home/valentin/projects/.worktrees/poteto-YPER4-677; path=d01735fb690d/13 entries

- [x] G4: Evidence limits and classification decisions have been reviewed against real representative tests and CI logs; unknown history, overlap and mutation outcomes are not claimed as proven.
  EVIDENCE: Reviewed accounts.test.cjs (Function loader plus source guard), account-token-revocation.test.cjs (behaviour with allowed/refused cases), add-column-visible.test.ts (mixed), agent-chat-reply-timeout.test.cjs (source-text), and app-performance-budget.test.cjs (executed subprocess, not a source-text guard). Corrected failure parsing against a successful stack following a failing summary; collector fixtures now enforce that negative control. Independently reconciled 20,766 raw-log top-level results to 2632.938935 callback seconds and 1014 step wall seconds. Report/README explicitly disclose heuristic binding/helper limits, bounded CI history, causal-regression/overlap/revert unknowns, sampled candidates, and non-additive wall-time costs. No existing tests changed.

- [ ] G5: Branch is pushed and one production-targeted PR has the repository-required ticket/INFRA title, hold label, ticket URL and command proof; no merge or board writes.
  EVIDENCE: pending
