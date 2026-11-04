## Registering new command routes

`parity-contract-trusted` checks candidate source against the protected production
contract first. A candidate-only registration cannot make an unknown route pass.
CI Boss owns protection updates: use [HYCI-115](https://app.hypertask.ai/detail/project-11514/115)
as the entry point for the Hypertask CI board (11514). App runners link the
app ticket or PR, exact error, and desired route, surface and job. CI Boss lands
registration in trusted production policy first; then the app runner rebases and
reruns the check.

For an existing job, CI Boss adds a reviewed planned transition with a concrete
entry, ticket URL and expiry within 30 days, plus one exact anchored pattern per
entry. Remove an existing exclusion for that surface when introducing its
transition. Do not add broad wildcards or exclusions to make a check pass. The
implementation must land all planned entries together and remove the completed
transition in its candidate contract. A genuinely new job requires a trusted
policy update; candidate policy cannot add jobs. Coordinate its protected update
with CI Boss rather than weakening the verifier.

The contract is `config/parity/contract.json`; generated outputs are
`config/parity/generated-inventory.json` and `docs/parity.md`. After the source
and contract are ready, regenerate both with
`node scripts/parity-contract.mjs --write --cli-capabilities <production-capabilities.json>`,
using capabilities from the pinned production CLI. Use
`node scripts/parity-contract.mjs --check --cli-capabilities <production-capabilities.json>`
to check them in GitHub-hosted checks, not on VPS runners. Trusted CI also
validates candidate artifacts using production code and policy.
