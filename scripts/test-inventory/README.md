# Source-text test inventory (YPER4-677, unit 1)

Ticket: https://app.hypertask.ai/detail/project-4060/677

This is an **inventory, not permission to remove tests**. Nothing in the app,
existing tests, feature flags, CI selection or workflows is changed. The report
is pinned to a production commit rather than the moving working tree.

## Reproduce offline

Requirements: Git with the pinned production history, Node 22+ (CI uses Node 24),
Python 3.12+, and the repository's locked TypeScript dependency. Install with
`npm ci --ignore-scripts --no-audit --no-fund` if dependencies are absent; this
inventory does not require Prisma generation, flag generation, a database or
running any existing tests.

```sh
node scripts/test-inventory/inventory.mjs --self-test
python3 scripts/test-inventory/collect.py --self-test
node scripts/test-inventory/inventory.mjs --check
node scripts/test-inventory/inventory.mjs --check-scope
```

`--check` regenerates both committed reports in memory and compares their exact
bytes. It checks the evidence schema, complete CI run listing, inspected-job
count, unique timing log lines, timing record/seconds reconciliation and unique
test rows before comparing. No network access or existing test execution occurs.
The JSON keeps each test object on one line to make changes to individual rows
reviewable; the Markdown has exactly one table row per test.

## Refresh evidence (read-only GitHub requests)

```sh
python3 scripts/test-inventory/collect.py --base origin/production
node scripts/test-inventory/inventory.mjs --write
node scripts/test-inventory/inventory.mjs --check
```

To repeat this exact git baseline, replace `origin/production` with the `base`
SHA in `docs/test-inventory/evidence.json`. GitHub retention and newer attempts
mean a fresh online collection is not guaranteed byte-identical to an earlier
collection. The committed sanitized snapshot is the offline reproducibility
input, not a claim that GitHub is immutable. `--refresh-logs` reparses the captured
failed-step jobs and timing job without relisting runs. Rendered commit links use unambiguous 12-character commit IDs; full hashes
remain in the JSON evidence. Raw logs never enter the repository: only whitelisted run/job metadata, hashes, test paths/line numbers
and durations are saved. GitHub authentication stays inside `gh`.

The collector splits the 30-day window ending at the baseline commit timestamp
into seven-day searches, follows pagination and refuses GitHub's 1,000-result
search truncation. It lists completed production push CI Tests runs and inspects
the latest attempt's `ci-tests` job for each non-cancelled/non-skipped/non-neutral
run. Only jobs with a failed Test/Test full suite step have their failure logs
read; one successful full-suite job supplies timing. A workflow failing before
Test is not attributed to any test. Earlier attempts, PR runs, non-completed runs,
other workflows, older history and success-masked test failures are outside this
query; none can be inferred to have passed. Failed-step log download errors are
counted as unavailable, not evidence of no failures. A failed log with no
recognized file remains unattributed in the snapshot.

## Classifier

Discovery follows the existing runner's test/spec suffix inventory under
`tests/`, using the pinned git tree rather than untracked fixtures. The script
does not replace or modify `scripts/test-inventory.mjs` or `scripts/run-tests.mjs`.

TypeScript parses CJS/TS test files into syntax trees. The heuristic tracks known
source readers, destructured read aliases, local variable/function flows, string
operations and source-helper naming conventions into assertion actual values.
Known module loaders, subprocesses, VM execution and `new Function` are execution
boundaries: reading text to execute a subject is not by itself a source-text
assertion. Temporary fixture reads are excluded when their argument identifies
that use. Literal guarded paths and extensionless imports resolve against the
pinned tree. Reported test titles describe **intent**, not established protection.
Dynamic test-name templates are preserved but not guessed for timing matching.

- **behaviour**: no detected source-text assertion and no unresolved source-only
  read flow. This is a non-source classification, not a test-quality endorsement.
- **source-text**: source-tainted assertions/source-only read flow without a
  detected separate runtime assertion, including structural AST/config guards.
- **mixed**: both source-tainted and other assertions with detected subject
  execution. The JSON retains assertion line numbers for inspection.

This is deliberately a **heuristic inventory**, not whole-program static
analysis. Bindings are approximated by names within a file; local shadowing,
parameter effects, mutation of containers, arbitrary helper names, generated
paths, assertions in imported helpers and unusual loaders can cause false
positives/negatives. There is no silent "perfect classification" claim.
`review-source-flow` and `review-no-direct-assertion` identify additional review
work, but `heuristic` does not mean manually verified. Inspect cited test lines
before using a classification for a follow-up. The fixture checks cover literal
behaviour, source regex/string guards, mixed files, source helpers/read aliases,
VM and Function loaders, a subprocess consuming a source-derived fixture,
extensionless paths, dynamic names, missing evidence and mandatory KEEP rules.

## Decisions and evidence

Every existing test is kept in unit 1. Required KEEP reasons are detected
conservatively from filename/test-title ticket numbers (including numeric
regression suffixes), access/security-related text and recent production bugfix
associations. Access/security keyword matches intentionally over-retain (for
example, AI token fixtures can match); allowed and refused cases are never split.
A recent bugfix association matches any touched test, literal guarded path or
referenced ticket against fix/regression/BUGFIX commits in the preceding 30 days.
The JSON records up to three most recent matching bugfix commits and the total
association count per test; one matching commit is sufficient KEEP evidence.
All reachable git history is read with first-parent merge diffs, exact paths,
without rename-following; old commits merged recently can be associated by the
merge's changed paths. History is not limited to just the last test edit.

**"Unknown" is an answer, not "no".** A historical red proves only that a test
can fail in CI; it does not establish a product regression or why it failed.
Git bugfix history establishes association, not that the test caught the bug.
No guarded-behaviour reverts were run in this inventory-only PR. Therefore every
potential revert-sensitive test stays KEEP; no unverified rewrite/delete call
can accidentally violate that protection. Behaviour coverage lists other files
with shared literal targets, plus runtime assertions in the same file. These
are triage candidates (the first five in sorted order, with the full candidate
count), **not proof of equivalent inputs, cases or boundaries**.
The per-row coverage and regression-caught answers remain explicitly unknown.
An all-time failure verdict, causal regression verdict, equivalent-behaviour
verdict and exhaustive mutation verdict require later investigation; this PR
does not claim to have established them for every source-text test.

## Explain the timing number

Timing comes from the pinned successful production full-suite log, not local
benchmarks. Only unindented top-level Node spec-reporter results are counted;
indented nested results are excluded so a parent suite and its children are not
both charged. Exact static test/suite names map to a file only when that name is
unique across the inventory. File-level result names map directly. Duplicate or
dynamic names stay unattributed. Test invocations repeated by the runner remain
repeated costs; the report does not pretend they were executed once.

The three class totals plus unattributed seconds and timed files absent from the
baseline reconcile to total reported top-level duration. This sum is **callback
elapsed seconds**, not CPU seconds and not the Test step's wall seconds: CJS
files run with four workers, isolated files run serially, TypeScript files run
serially through tsx, and imports/startup/setup/teardown are not fully visible in
the reporter. A file with no matching result has unknown cost, not zero cost.
The report separately gives actual step wall seconds; it makes **no projected
CI savings claim**. Measuring marginal wall cost per class needs a later
instrumented CI experiment, not dividing overlapping callback time by workers.
