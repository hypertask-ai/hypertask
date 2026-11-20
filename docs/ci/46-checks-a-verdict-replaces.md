## Checks a verdict replaces (HTPR-9450, second pass)

pstack's shipping playbook: green CI and an approving bot review are not
verdicts, and a few cheap checks plus an independent agent verdict beat a wall of
gates. The first pass made `pstack-verifier` the only required context. This pass
takes three more lanes off the pull request, each because a rule it enforced is
now enforced by the verifier or by a lane that was already running.

### UX sign-off

[`ux-signoff-gate.yml`](../.github/workflows/ux-signoff-gate.yml) no longer runs on
a pull request event. It runs on manual dispatch and on the hourly sweep
[`ux-signoff-chain.yml`](../.github/workflows/ux-signoff-chain.yml) dispatches,
which reconciles every open production pull request from its ticket comments and
posts the same `ux-signoff` status. A person's sign-off is not something a check
can produce, and the verifier drives the journeys the sign-off is about, so the
status is a signal within the hour instead of a job on every push. The rules in
[`.claude/reference/flags.md`](../../.claude/reference/flags.md) are unchanged.

### Feature-map coverage

The coverage-growth counter left the pull request gate (HTPR-9512). A pull
request no longer has to grow the map: `.github/scripts/feature-map-coverage.cjs`
and its unit test are deleted, because no workflow, report or nightly run read
them once the lane went. What a pull request keeps is the
[feature-map change gate](../ci.md#feature-map-change-gate-htpr-9415): a new
feature or improvement still needs its area page.

### The feature-map citation check

It stays in the Monday 03:37 UTC run of
[`feature-map-weekly.yml`](../.github/workflows/feature-map-weekly.yml) and on
manual dispatch. The pull request trigger moved into `skills-evals`: the same
offline fixture test and the same dependency-free checker run in that job when a
skill, map, ops-map or weekly-file path changes, so a stale citation still fails
the pull request that introduced it without a second workflow.

### Repro first

A `[BUGFIX]` pull request's proof is now the `repro-first` job inside
`ci-tests.yml`, which replaced the separate workflow. It is the same job and the
same script: it skips when no source file changed, and otherwise requires a
changed test to fail on the merge base and pass on the head. It fails its own
step and is not part of the `ci-tests` summary, so a missing proof is loud without
silently reddening the build check.

### The review precheck in CI Tests

`ci-tests` no longer reads `ai-review` or `claude-review` before it starts. The
prepare step that stopped the build on an already-red review is gone, with the
`statuses: read` permission it needed, so a review is advice and never a gate: a
non-draft pull request builds and tests whatever the bots said. pstack's
shipping playbook counts only the independent agent verdict, and a review that
steps a build away buys nothing a red check on the head does not already say.

### Test lanes on a pull request

A production push still runs the full suite in six pool lanes plus two serial
lanes. A pull request runs the selector's scoped pick in three pool lanes plus one
serial lane, so a head pays four test jobs instead of eight. The lane plan is the
same `shard-tests.mjs` partition; only its lane count changes, and `--check`,
`--prove` and the shard matrix all read the same two numbers.
