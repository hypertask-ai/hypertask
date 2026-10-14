# Gates: YPER4-379 forbid explanatory source comments

OWNS: GATES.md, eslint.config.mjs, eslint-local-rules/no-comments.mjs, scripts/strip-comments.mjs, tests/no-comments-rule.test.cjs, tests/strip-comments.test.cjs, src/**

Scope: Enforce tool-only comments in src, remove explanatory comments without changing program ASTs or JSX rendering, and make local logical commits only. No pushes, PRs, board writes, other worktrees, or stash. Checks require Ubuntu bash and installed project dependencies; raw logs are saved under /tmp/yper4-379-checks.

- [ ] G1: Rule tests prove all forbidden and allowed kinds, generated exemptions, exact diagnostics, and src-only configuration
  CHECK: node --test tests/no-comments-rule.test.cjs > /tmp/yper4-379-checks/rule.log 2>&1 && tail -12 /tmp/yper4-379-checks/rule.log
  EXPECT: /# fail 0\b/
  EVIDENCE: pending

- [ ] G2: Codemod tests prove exact ranges, whitespace, JSX safety, idempotence, check mode, and a failing AST-equivalence negative control
  CHECK: node --test tests/strip-comments.test.cjs > /tmp/yper4-379-checks/codemod.log 2>&1 && tail -12 /tmp/yper4-379-checks/codemod.log
  EXPECT: /# fail 0\b/
  EVIDENCE: pending

- [ ] G3: Every changed source file has an equivalent normalized AST against the starting production commit
  CHECK: node scripts/strip-comments.mjs --verify-against origin/production > /tmp/yper4-379-checks/ast.log 2>&1 && tail -12 /tmp/yper4-379-checks/ast.log
  EXPECT: 0 mismatches
  EVIDENCE: pending

- [ ] G4: No disallowed source comments remain, and the codemod has no outstanding rewrite
  CHECK: node scripts/strip-comments.mjs --check src > /tmp/yper4-379-checks/comment-check.log 2>&1 && tail -12 /tmp/yper4-379-checks/comment-check.log
  EXPECT: 0 files with disallowed comments
  EVIDENCE: pending

- [ ] G5: TypeScript passes after all ts-ignore removals and justified expect-error conversions
  CHECK: npm run typecheck > /tmp/yper4-379-checks/typecheck.log 2>&1 && tail -12 /tmp/yper4-379-checks/typecheck.log
  EXPECT: tsc --noEmit
  EVIDENCE: pending

- [ ] G6: Full lint passes with local/no-comments and unused src directives enforced
  CHECK: npm run lint > /tmp/yper4-379-checks/lint.log 2>&1 && tail -12 /tmp/yper4-379-checks/lint.log
  EXPECT: eslint .
  EVIDENCE: pending

- [ ] G7: Full test suite passes, or unavailable infrastructure and baseline-proven failures are explicitly handed off without suppression
  CHECK: npm test > /tmp/yper4-379-checks/test.log 2>&1 && tail -18 /tmp/yper4-379-checks/test.log
  EXPECT: /# fail 0\b/
  EVIDENCE: pending

- [ ] G8: Next build completes within the requested machine budget, without running production migrations
  CHECK: bash scripts/heavy-job.sh --exclusive timeout 900 npx next build > /tmp/yper4-379-checks/build.log 2>&1 && tail -18 /tmp/yper4-379-checks/build.log
  EXPECT: /(?:Route \(app\)|Route \(pages\)|Compiled successfully)/
  EVIDENCE: pending

- [ ] G9: Local commits separate enforcement and tooling from source removal; source counts and ts-ignore, stale-directive, retained-JSX outcomes are measured; worktree ends clean
  EVIDENCE: pending
