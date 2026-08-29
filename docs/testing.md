# Automated testing contract

Hypertask protects important behavior with automated tests in the same pull request that changes it. The objective is regression safety, not maximizing a coverage percentage or test count.

## Required evidence by change type

| Change | Minimum automated evidence |
| --- | --- |
| Bug fix | A regression test that demonstrates the broken behavior and passes with the fix. When practical, prove it fails against the previous implementation. |
| New or changed business rule | Behavioral unit or integration tests for the happy path, authorization boundary, failure path, and material edge cases. Test-first development is preferred. |
| Authentication, authorization, billing, task writes, managed-agent writes, realtime ownership, or release controls | Behavioral tests are mandatory. Source-text assertions alone are not sufficient. |
| User interaction | Test the extracted behavior directly. Add browser verification when correctness depends on routing, rendering, focus, persistence, or multiple system boundaries. |
| Visual-only CSS or copy | No new automated test is required when behavior is unchanged. Record that judgment in the PR. |
| Documentation or mechanical refactor | Existing focused tests may be sufficient. The PR must name them or explain why execution adds no signal. |

An exception is acceptable only when reliable automation would be disproportionate or impossible. State the reason, the manual evidence, and the residual risk in the PR. “The change is small” is not an exception for critical behavior.

## Test levels

Choose the lowest level that proves the real contract:

1. **Behavioral unit test:** call an exported function with realistic inputs and assert outputs or state transitions.
2. **Controller or route integration test:** call the controller or route handler with isolated fakes and assert authorization, persistence requests, idempotency, and side effects.
3. **Browser journey:** use the Verification Fleet when correctness spans the rendered application, navigation, authentication, persistence, and reload behavior.
4. **Structural guard:** inspect source or configuration only when the structure itself is the contract, such as a workflow permission or prohibited environment-variable pattern.

Do not use source-text matching as a substitute for callable behavior. A harmless rename should not break a behavioral test, and an equivalent but insecure implementation should not pass it.

The retained release workflow and host-policy checks are classified in [`release-control-test-classification.md`](release-control-test-classification.md). Add a structural release guard only when that document names the declarative trust boundary it protects.

## Test-driven development

Use red-green-refactor for bug fixes and isolated business logic:

1. Add or identify a test that fails for the reported behavior.
2. Implement the smallest complete correction.
3. Make the focused test pass.
4. Refactor while keeping the behavior green.

Strict test-first development is optional for visual exploration and legacy seams that must first be made testable. Before merge, the stable behavior still needs the evidence required by the table above.

## Determinism and isolation

- Never call production services or mutate production/customer data from the repository test suite.
- Set safe test environment variables before importing modules that initialize clients.
- Replace Prisma, Stripe, queues, email, and realtime clients with explicit fakes at the closest stable boundary.
- Assert both allowed and denied identities for access-controlled behavior.
- Cover retries, duplicate delivery, stale state, and concurrent calls when the production code promises idempotency or durability.
- Use fixed clocks and deterministic identifiers where time or randomness affects assertions.
- Clean up global mocks and environment changes after every test file.

## File conventions and commands

The required CI entrypoint is:

```bash
npm test
```

It recursively discovers and executes these supported formats:

- `tests/**/*.test.cjs` through Node's test runner.
- `tests/**/*.test.ts` through `tsx` for legacy assert-based TypeScript tests.

Any committed `*.test.*` or `*.spec.*` file outside those formats fails the inventory check instead of being silently skipped.

Run focused tests while developing:

```bash
npm run test:file -- tests/auth-url-safety.test.cjs
npm run test:file -- tests/security/getCount.test.ts
```

Name tests after the behavior or regression they protect. Ticket numbers may appear in comments, but the filename and test title must remain understandable after the ticket is forgotten.

## Coverage baseline

The `staging` CI run collects native V8 coverage while it runs the authoritative suite. It publishes `automated-test-coverage-<commit>` for 30 days with:

- Istanbul's machine-readable `coverage-summary.json`;
- `critical-domains.json` for automation;
- a rendered CI job summary and `critical-domains.md`, grouped into auth/access, task writes, billing, agents/AI writes, realtime/notifications, and release controls.

The baseline is deliberately **report-only**. A low percentage does not block a merge yet, and source-text guard tests cannot inflate the result because only executed production code is counted. Generated code, migrations, fixtures, and tests are excluded.

Run the same report locally after collecting coverage:

```bash
NODE_V8_COVERAGE=coverage/raw npm test
npm run coverage:report
```

Use the largest critical gaps to choose behavioral-test work. Add percentage thresholds only after multiple stable runs establish that the measurement itself is reliable.

## Pull-request contract

Every behavioral PR records:

- the new or updated test files;
- the focused commands and results;
- whether the regression test failed before the fix, when applicable;
- any reason automation does not apply;
- remaining risk that requires browser or production verification.

Required CI remains authoritative for the complete suite. Automated review should challenge missing behavioral coverage in critical domains even when the current suite is green.
