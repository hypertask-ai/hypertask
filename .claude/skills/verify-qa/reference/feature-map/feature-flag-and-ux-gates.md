# Feature-flag and UX sign-off gates

## How a customer reaches it

The feature-flag-gate and ux-signoff checks on pull requests to production use trusted production code and post commit statuses. Feature-flag PR events evaluate only their target; fleet reconciliation runs on a fifteen-minute schedule. This is infrastructure, with no app UI or account writes.

## How to drive it

After merge, observe the next production pull-request event. Require the per-PR feature-flag job to succeed and the fleet job to skip. Then observe two scheduled runs: only the fleet job should run. GitHub may delay scheduled starts; do not generate PR events to force fleet sweeps.

- The first run after a change to the status format judges every open PR once (`evaluated N, skipped 0`).
- A later run within 30 minutes skips PRs whose head, base, title and labels are unchanged (`skip #N: unchanged since its last status under 30 minutes ago`, then `evaluated N, skipped M`).
- A rate limit shows as `GitHub API rate limited; waiting Ns until reset` and then a normal result, or as `::warning::skipped: GitHub rate limited until <time>` with a green job and no error status.

The positive control is the per-PR feature-flag-gate job: it still judges and posts its own result. PR and fleet runs retain the same non-cancelling concurrency group so a sweep cannot race a PR verdict. The group uses GitHub `queue: max` to retain up to 100 pending PR runs; a burst beyond that limit cancels new arrivals until scheduled reconciliation. Inspect the production workflow for that setting and retain a queued-run example when available.

## What usually breaks

- A rate limit turning into a red check or an error status instead of a wait or a clean skip.
- A wait after the verdict letting a stale approval be posted (title, labels, shared head or ticket approval changed during the wait).
- The skip keeping a green for a fork PR, a shared head or a PR whose labels changed.
- A genuine API failure (plain 403, 404, 500) ending green.

## What proof to collect

Save a post-merge PR run showing target success and fleet skip, plus two scheduled runs showing the inverse job selection. Keep fleet logs with `evaluated N, skipped M` and any quota or infrastructure failures. A format change requires the first full judge and following skipping run; an unchanged format can skip immediately. Doctor: the merge sha on origin/production. Record run ids, never tokens.

### Automated evidence

`node --test tests/feature-flag-reconcile-workflow.test.cjs` exercises unchanged-PR skipping, metadata invalidation, rate-limit handling and genuine API failures with workflow fixtures.
`node --test tests/ux-signoff-gate.test.cjs` exercises UX verdicts and reconciliation, including rate-limit skips without stale approval and refusal of ordinary API failures.

## Imported formatter gates

The evaluator entry point is `evaluate` in `.github/scripts/feature-flag-gate.mjs`.
After deployment, read the trusted feature-flag check on a production PR that passes its ticket flag through an imported formatter (for example, https://github.com/hypertask-ai/hypertask/pull/2237).
Require the check's `ffg=` stamp to identify production containing the repair; an older passing status is not live proof.
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

## Cleanup

None. Nothing is created.
