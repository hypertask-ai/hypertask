## Board registration boundary (HTPR-8190)

The existing `ci-checks` job runs dependency-cruiser 16.10.4, pinned in the
lockfile, against board command registration. The rule checks direct imports
from `domains/boardCommands.ts`: only `HTCTypes`, model and enum contracts may
come from `src`. Other legacy registrations are outside this rule. The
`tests/domain-boundary.test.cjs` fixtures prove allowed contracts and assembly
imports pass, and concrete domain imports fail. The scan runs on non-documentation
changes and unknown diffs; boundary-only runs skip the existing full checks.
The existing `ci-tests` summary requires the scan job when selected. No required
context is added.

Hosted `ship-scripts-tests` runs the pickup domain fixture with
`python3 .claude/skills/ship/scripts/runner-pickup.domain.test.py`, alongside
`runner-pickup.recovery.test.py` and `runner-pickup.test.sh`. These cover pickup
coordination, not manual claims.
