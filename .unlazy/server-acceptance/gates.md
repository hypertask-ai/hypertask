# Server acceptance enforcement

- [x] Owner-controlled project enrollment and immutable criteria contracts.
- [x] Authority-only revision and grant registration, actor-bound consumption.
- [x] Move/update/batch and lifecycle escape guards.
- [x] Executed boundary regressions and type checks. Twenty new boundary tests pass. The final selected controller/PostgreSQL suite passes all 52 tests. The executed native-update regression proves a late enrollment change returns a structured failure with no contract write. The selected boundary run passed 60 tests before the final wire regression. The two repaired fixture files pass 27 tests. TypeScript no-emit check passes.
- [ ] Full repository regression suite green. The full Node run completed with 4,001 passes and 23 failures. Eighteen failures were outdated fixtures and pass in their corrected 27-test rerun. Five parity-policy failures remain. All 58 TypeScript test files pass.
- [ ] Protected parity-policy prerequisite merged. The two new API catalog entries need a separate planned policy change before implementation can pass the protected-base verifier.
- [ ] Parent review of exact diff.
- [ ] Migration and deployed end-to-end acceptance verification, parent-owned.

No live enrollment, migration, commit or deployment is authorized for this leaf.

The migration creates five empty tables and four indexes. It does not enroll a project. Apply the migration before serving code that queries these tables. The normal build command includes the production migration runner, so this leaf only ran Prisma client generation and TypeScript checks.

Boundary tests use an in-memory transaction adapter and execute the actual enforcement service, central controller and factory HTTP handler. A separate disposable PostgreSQL test passed with HT_REQUIRE_PG_TESTS=1. It proves rollback of task, grant and linked request, one consumption plus one replay under concurrent calls, and rejection of an old receipt after moving away. The loopback-only test container used bounded tmpfs and was removed. No existing container or product database was used.

The server trusts evidence decisions from the explicitly enrolled authority identity. The parent must isolate its credentials and verify GitHub/code evidence in the reusable runtime. The application compares the registered SHA, task updatedAt, actor, target section, contract version, enrollment version, and revision epoch. It does not independently fetch GitHub during a task move.

QA requests, grants, and consumption require current assignment and independence from all recorded implementers. QA waiting/handoff does not update the developer writer or implementer history.

Grant responses include durable requestId. Status returns the exact requested request and grant separately from the bounded history, retaining consumed receipts after revision changes.

The linked request is marked consumed atomically with grant/task mutation. Revision changes preserve consumed requests. Registered criteria are append-only across IDs, kinds, phases and descriptions.

Explicit section names must match the effective section identity for enrolled actors, including unchanged IDs and null IDs. Central-controller regressions cover the bypasses and valid or unenrolled behavior.

Activation gap: enrollment and per-ticket criterion registration require authenticated project-owner access. Neither the CEO agent nor the authority agent can perform that setup. Unattended handling of existing tickets therefore needs an explicitly owner-approved bootstrap/delegation mechanism or approved contract-template binding. No such mechanism is implemented here; owner impersonation and silently granting agents approval rights remain prohibited. Resolve this against the canonical plan before activation, alongside authority isolation and trusted evidence collection.

## Owner template slice

- [x] Owner-session template and semantic receipt registration, with same-origin POST and no bearer impersonation.
- [x] Server-selected binding for existing/future tasks with explicit approved semantics.
- [x] Approved scope editing guards, stale version/content rejection and preserved independent QA.
- [x] 73 focused acceptance/controller/parity tests, two disposable PostgreSQL tests, native update regression, TypeScript and migration-history regression pass.
- [ ] Parent review and PR update for this separate slice.
- [ ] Owner UI and intake wiring. Future binding needs a semantic receipt; unattended intake is not yet complete.
- [ ] Trusted evidence authority outside provider control. No credential deployment or activation is authorized by these passing backend tests.
