# HTPR-8190 domain map

The [baseline](code-maat-baseline-htpr-8190.md) identifies shared hotspots,
not proven conflicts. These paths describe current entry points, not a complete
inventory of every related file.

| Domain | Entry points and closely coupled paths |
| --- | --- |
| Commands | `src/components/Modals/commands/HTC/commands.tsx`, `AllCommands.ts`, `domains/boardCommands.ts` |
| Flags | `src/lib/flags.ts`, `src/lib/flags/`, `tests/feature-flags.test.cjs`, `e2e/smoke/production-flag-modes.json` |
| Search | `src/pages/api/search/`, `tests/search-chips-values.test.cjs` |
| Prompts | `src/lib/ai/prompts/`, `tests/fixtures/ai/prompt-baseline.json` |
| Parity | `config/parity/`, `docs/parity.md`, `scripts/parity-contract.mjs`, `scripts/parity-ai-chat-inventory.mjs` |
| Shipping | `.claude/skills/ship/`, `docs/ci.md`, `docs/ci-policy.yml` |
| Shared | Other paths, and changes spanning domains, require shared coordination. |

The board command seam owns board navigation, archive and My Tasks picker
registration. `commands.tsx` still assembles and ranks all groups. The scope of enforcement is described below.

## Enforced boundaries

Dependency-cruiser checks direct imports from the board registration file.
It permits `HTCTypes` and the shared model and enum
contracts. Other `src` imports are forbidden there. The root command assembly
can import the board registration. Other legacy domains are not covered by this
rule; this is not a repository-wide cross-domain ban. CI runs the scan and CLI
fixtures in `ci-checks` for non-documentation changes.

## Pickup ownership

Pickup reads explicit task labels `Domain: Commands`, `Domain: Flags`,
`Domain: Search`, `Domain: Prompts`, `Domain: Parity`, or `Domain: Shipping`.
No matching label, or multiple matching labels, means `Shared`. Shared conflicts
with every domain. Pickup persists ticket ownership under the runner inbox state
and serializes reconciliation and queue generation with one flock. An active
lease does not expire. An assigned task in an active or review column keeps its
lease; completed or unassigned tasks release it after a successful readback.
Incomplete list pages cannot release leases. A missing task needs a successful
individual readback. Older inbox tickets without known leases are treated as Shared until
reconciled; known leases retain their domain. Ownership applies to pickup, not
manual claims. It cannot discover pre-existing manual work before that runner's first successful pickup tick. Imported active work can already conflict;
importing it does not guarantee exclusive ownership.

### Internal operations QA

After installation, run `~/.local/lib/hypertask/runner-pickup/runner-pickup preview N`
for a runner. It reads every assigned Normal task page and prints task labels,
sections, and the current ownership file, without queue or board writes. Compare
labels and active tickets with the board. This is a snapshot, not a reservation
or a concurrency proof. Use the offline pickup fixtures in hosted CI for actual
queue dispatch and concurrent admission checks. Do not use a live `run` as a
read-only check.
