# Release-control test classification

**Release decisions run as executable tests wherever the repository can call the decision code.** Source-text checks remain only for declarative trust boundaries whose file structure is the contract.

## Executable controls

These suites import a release module or run the real workflow shell block against isolated fakes:

### Core release decisions

- `tests/automerge-workflow.test.cjs` executes auto-merge decisions, failure handling, risky-path parking, speed gates, and cleanup.
- `tests/prod-health-workflow.test.cjs` executes health classification and rollback decisions with fake Vercel, app, and Telegram responses.
- `tests/emergency-rollback.test.cjs` calls the rollback module with a fake Vercel client.
- `tests/review-dispatch-cache.test.cjs` runs the review broker and scanner with fake GitHub responses.
- `tests/action-archive-cache.test.cjs` runs the cache installer against fake downloads and concurrent writers.

### Release support

- `tests/production-migrations.test.cjs` calls the migration runner with fake environments and process execution.
- `tests/select-tests.test.cjs` and `tests/test-inventory.test.cjs` call the test selection and inventory modules.
- `tests/app-performance-budget.test.cjs` and `tests/speed-pr-evidence.test.cjs` execute the performance checkers. The speed suite also executes the workflow shell block for file inventory and status behavior.
- `tests/coverage-summary.test.cjs` and `tests/relocate-eslint-cache.test.cjs` call their release-support modules directly.

The auto-merge suite previously matched counter names in workflow text. HTPR-5382 replaced that check with an executed merge failure that proves a nonzero result and cleanup.

## Retained structural guards

| Test | Structural contract | Why source inspection is correct |
| --- | --- | --- |
| `tests/action-archive-cache.test.cjs` | Every remote workflow action uses an exact 40-character commit and appears in the immutable cache manifest. | GitHub resolves `uses:` references before repository code runs. The workflow reference itself is the supply-chain policy. |
| `tests/automerge-workflow.test.cjs` | Auto-merge scratch files use a unique directory below `RUNNER_TEMP`, register cleanup, and never use fixed `/tmp` paths. | The path namespace and trap declaration are the shared-runner isolation contract. Executed tests separately prove creation failure and successful cleanup. |
| `tests/ci-dependency-cache.test.cjs` | The cache key names every install input, pull requests cannot save caches, and installs use the approved command. | Cache keys, event conditions, and action placement are declarative GitHub Actions configuration. No exported application function decides them. |
| `tests/review-runner-host.test.cjs` | Sudo identities, installed owners and modes, systemd user and cadence, trusted instruction channels, dispatch type, and forbidden application workflow paths. | These files define the OS and repository trust boundary. Replacing them with a process fake would stop checking the deployed permissions and wiring. Broker behavior is covered separately in `tests/review-dispatch-cache.test.cjs`. |
| `tests/speed-pr-evidence.test.cjs` | The workflow uses `pull_request_target`, checks out trusted base code, has narrow status permission, and never checks out pull-request head code. | GitHub selects the workflow source, event permissions, and checkout ref before the shell block runs. Executed tests cover the shell decisions after that boundary. |

## Review rule

A new source-text release guard must name a declarative trust boundary in this document. If it protects a decision inside JavaScript, TypeScript, or shell, expose or execute that decision with fakes instead.
