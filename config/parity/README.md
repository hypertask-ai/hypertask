# Parity runner trust updates

**The parity runner executes only CLI artifacts selected by reviewed locks and hashes.** `npm ci --ignore-scripts` verifies the locked package against `runner/package-lock.json` and installs the pinned TypeScript. The CLI itself is the native release binary: both workflows download one exact release, verify its reviewed SHA-256 digest, and execute that file directly.

Production CLI upgrades use two small merges so an untrusted pull request cannot choose code that the protected-base verifier executes:

1. Keep the current runner and contract unchanged. Review and pin the next native release in both workflows, allowing npm latest to equal only the current or exact next version.
2. Update the runner lock, contract, generated inventory, and report together. Promote the next version to current and remove the transition in the same merge.

No transition is active now: native CLI 2.0.9 (release v0.2.14) is the current version in the runner lock, the contract and both workflows, and npm latest must equal it.

The `pull_request_target` check always compares the candidate runner files with the protected base branch and treats candidate source as data only.

Contract policy uses the same two-step rule. Land match or exclusion changes
without the dependent surface change first. When a new job or surface cannot
yet satisfy the completeness rule, add a narrowly matched `planned` object for
that job and surface. It must name the exact future catalog entries, link the
Hypertask follow-up ticket, and expire within 30 days. The trusted workflow
validates candidate source against the protected base contract and exact
baseline inventory, so removals fail while the policy-only change can land.
The implementation PR then removes `planned`; the validator requires removal
as soon as every named entry exists.
