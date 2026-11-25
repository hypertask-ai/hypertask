# Feature-flag and UX sign-off gates

## Sub-features

- `imported-formatter-gates` Imported formatter gates.

## How to get to it (user POV)

The feature-flag-gate and ux-signoff checks use trusted production code and post commit statuses. Feature-flag pull request events evaluate only their target; fleet reconciliation runs on a fifteen-minute schedule. The ux-signoff gate runs only on that hourly dispatch and on manual dispatch, not on pull request events (HTPR-9450). This is infrastructure, with no app UI or account writes.

## Driving it with agent-browser

No browser. Drive it with `gh`. Verified 2026-11-20:

1. `gh run list --workflow=feature-flag-gate.yml --limit 8 --json databaseId,event,conclusion`
   shows current `pull_request_target` runs (many `skipped`: the per-PR job
   skips when the head is unchanged) and scheduled runs.
2. Split the job selection on both:
   `gh api repos/hypertask-ai/hypertask/actions/runs/<pr-run>/jobs --jq
   '.jobs[]|"\(.name) \(.conclusion)"'` for a PR run, and the same for a
   schedule run. The PR run runs `feature-flag-gate`; the schedule run runs
   only `reconcile-feature-flag-gate` and skips the per-PR job.
3. Read a green schedule run's reconcile log:
   `gh run view <schedule-run> --repo hypertask-ai/hypertask --log | grep -E
   'evaluated [0-9]+, skipped [0-9]+|skip #[0-9]+'` prints lines such as
   `skip #3718: unchanged since its last status under 30 minutes ago` and
   `evaluated 108, skipped 3`.
4. UX sign-off only runs on dispatch:
   `gh run list --workflow=ux-signoff-gate.yml --limit 3` shows
   `workflow_dispatch` events; the log reconciles PRs with verdicts such as
   `No visible UI change` and `No new component file; reused UI ships behind
   its flag without a wireframe`.
5. Read the live per-PR status, not a stamp:
   `gh api repos/hypertask-ai/hypertask/commits/<head>/statuses --jq
   '.[]|select(.context=="feature-flag-gate")|{state,description}'`.
6. Count cancellations before calling the fleet healthy:
   `gh run list --workflow=feature-flag-gate.yml --event schedule --limit 5`.
   Three of the five runs on 2026-11-20 were `cancelled` at about ten minutes;
   record that as a gap.
7. Do not generate PR events or dispatch to force a sweep.

- The first run after a change keeps skipping PRs already stamped `success`/`failure` with unchanged head, base, title and labels; the status description/format is not part of the fingerprint, so a format change alone never forces a full judge.
- A later run within 30 minutes skips PRs whose head, base, title and labels are unchanged (`skip #N: unchanged since its last status under 30 minutes ago`, then `evaluated N, skipped M`).
- A rate limit shows as `GitHub API rate limited; waiting Ns until reset` and then a normal result, or as `::warning::skipped: GitHub rate limited until <time>` with a green job and no error status. A run that exits on a batched rate limit prints only the warning, not the counters.
- A scheduled fleet run cancelled mid-sweep posts nothing (observed 3 of 5 recent runs cancelled at ~10 minutes). Record it as a gap, not a pass.

The positive control is the per-PR feature-flag-gate job: it still judges and posts its own result. PR and fleet runs do not share a concurrency group: the group is `feature-flag-gate-${{ github.event.pull_request.number || github.ref }}` and `cancel-in-progress: true`, with no `queue:` key; GitHub rejects `queue: max` beside cancellation. A fleet sweep is cancelled if another run enters the same `refs/heads/production` group.

## Gotchas

- A rate limit turning into a red check or an error status instead of a wait or a clean skip.
- A wait after the verdict letting a stale approval be posted (title, labels, shared head or ticket approval changed during the wait).
- The skip keeping a green for a fork PR, a shared head or a PR whose labels changed.
- A genuine API failure (plain 403, 404, 500) ending green.

### What proof to collect

Save a post-merge PR run showing target success and fleet skip, plus two scheduled runs showing the inverse job selection. Keep fleet logs with `evaluated N, skipped M` and any quota or infrastructure failures. A format change requires the first full judge and following skipping run; an unchanged format can skip immediately. Doctor: the merge sha on origin/production. Record run ids, never tokens.

### Automated evidence

`node --test tests/feature-flag-reconcile-workflow.test.cjs` exercises unchanged-PR skipping, metadata invalidation, rate-limit handling and genuine API failures with workflow fixtures.
`node --test tests/ux-signoff-gate.test.cjs` exercises UX verdicts and reconciliation, including rate-limit skips without stale approval and refusal of ordinary API failures.

### Imported formatter gates

The evaluator entry point is `evaluate` in `.github/scripts/feature-flag-gate.mjs`.
After deployment, read the trusted feature-flag check on a production PR that passes its ticket flag through an imported formatter (for example, https://github.com/hypertask-ai/hypertask/pull/2237).
The published status description is human-readable and carries no `ffg=` stamp; the fingerprint `ffg=<base>.<hash(title,labels)>` is internal, used to decide skips. Identify the production containing the repair from the run's base SHA and the status `updated_at`, not from a description stamp. An older passing status is not live proof.
Do not change that PR, its flag, or its ticket during verification.

Hosted `tests/feature-flag-gate.test.cjs` must prove the formatter groups: aliased parameters, explicit live return branches, rendered consumers, return truthiness, invariant guards, independent boolean inputs, formatter dependency/render consumption async server consumers and render coercion/omitted defaults.
These fixtures exercise the real `evaluate` entry point with committed repositories, not copied helpers.
The allowed controls include relative and `@/` imports, top-level early returns, direct conditional rendering, independent caller boolean conjunctions and boolean negation.
Refused controls include ignored or overwritten parameters, nested contradictory guards, exception overrides, invariant comparisons, conditional guards with unknown or constant truthiness, correlated parameters, dependent parameter defaults, truthy masks and discarded output.
Constant defaults remain supported; direct formatter calls use the same consumer proof as assigned results.
Dependency controls include correlated object fields and shorthand values, independent component props and immutable aliases.
Caller-bound literal fields, nested objects and constant aliases must reject invariant conditions while preserving true conjunction and false disjunction controls.
A property named `enabled` is not a reference to the flag parameter; independent fields with that name remain supported.
Missing, inherited, ambiguous and prototype-setter properties are unsupported static lookups, not falsy own values; own-field overrides still work.
Resolve explicit undefined arguments using the formatter's constant parameter defaults, and reject writes to secondary parameters.
Unsupported compound operands fail closed; only constants and proven-independent parameter paths may participate in formatter conditions.
Object parameter defaults referencing another parameter cannot establish independence.
Empty fragments (including nested fragments) and boolean-only render branches cannot prove visible output.
Boolean coercion after choosing JSX cannot prove visible output; negating the condition before choosing JSX remains supported.
Omitted independent constant defaults and optional parameters remain supported for both import styles; masking or correlated defaults remain refused.
Empty arrays, nested empty arrays and sparse arrays cannot certify visible output; arrays containing rendered elements remain supported.
Spread array and string literals follow the same visibility rule, including nested spreads; unknown spread operands alone cannot prove visible output.
Visible spread elements and visible siblings of unknown spreads remain supported.
Boolean invisibility applies only to React output; distinct JSON boolean responses remain valid server gates.
Imported server formatters follow that same response rule for direct calls and immutable assigned results; ignored calls and identical responses remain refused.
Interpolated template children need known nonempty literal text to prove visibility; empty or unknown interpolation-only children remain refused.
Async server-component consumers of synchronous formatters remain supported; async formatters still cannot prove a truthiness gate.
Consumed logical and nested conditional JSX render paths pass; discarded or comma-masked JSX fails.
JSX returned only by an event handler cannot prove rendering; a binding returned by the rendered component still can.
Unrelated component parameter defaults do not constrain formatter proof; formatter defaults retain their own validation.
Compound value expressions cannot borrow the boolean parameter comparison proof; direct boolean and negated-boolean comparisons remain supported.
Boolean-producing operators and void expressions remain invisible inside React arrays; visible siblings still work.
Early exits in live action handlers must control a reachable effect, including nested blocks; pure ignored handler returns and unreachable effects remain refused.
Exported capitalized component bindings returning text or arrays need no JSX node to establish render liveness, including JavaScript files. Lowercase exported actions retain effect-based analysis regardless of their file extension.
Logical and conditional boolean-only children remain invisible, including statically masked text; zero remains visible React output. Consumer branches must differ in visibility, not just syntax; equivalent text arrays and strings cannot prove an effective switch.
Save the tested head SHA, hosted run URL and successful group lines.
A local AST reproduction supplements those results; it does not replace evaluator or trusted-workflow proof.
No app output changes, so theme screenshots and customer-data writes are unnecessary.

### Cleanup

None. Nothing is created.

Nullish render children select the actually returned operand: null-to-boolean stays invisible, null-to-text and zero remain visible. Logical render reachability resolves immutable constant aliases, including truthy arrays and objects; masked JSX cannot prove a formatter gate. Keep reachable conjunction and disjunction controls beside those refusals.
