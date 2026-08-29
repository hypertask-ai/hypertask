# Parity runner trust updates

**The parity runner executes only the CLI and TypeScript dependency tree pinned in `runner/package-lock.json`.** `npm ci --ignore-scripts` verifies every package against that reviewed lockfile before the catalog check runs.

Production CLI upgrades use two small merges so an untrusted pull request cannot choose code that the protected-base verifier executes:

1. Update `runner/package.json`, regenerate `runner/package-lock.json`, and update the trusted workflow constants. Merge after manual review of the sensitive parity paths.
2. Update the contract, generated inventory, and report to the now-trusted production CLI version.

The `pull_request_target` check always installs the lockfile from the protected base branch and treats candidate source as data only.

Contract policy uses the same two-step rule. Land match or exclusion changes
without the dependent surface change first. When a new job or surface cannot
yet satisfy the completeness rule, add a narrowly matched `planned` object for
that job and surface. It must name the exact future catalog entries, link the
Hypertask follow-up ticket, and expire within 30 days. The trusted workflow
validates candidate source against the protected base contract and exact
baseline inventory, so removals fail while the policy-only change can land.
The implementation PR then removes `planned`; the validator requires removal
as soon as every named entry exists.
