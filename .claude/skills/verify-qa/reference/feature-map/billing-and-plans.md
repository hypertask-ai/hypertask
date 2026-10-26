# Billing and plans

## How a customer reaches it

- Sign in, open an owned board, then Settings > Team > Billing (`/settings/billing`).
- Click Manage subscription to reach Plans (`/settings/plans`); `/pricing` is a legacy entry that defaults to Plans. Its `preSelect` query also routes `API Keys` to Bring your own key, `Billing` to Billing, `Members` to Team > Members, and `Settings` to Profile > General.
- Billing > Payment method > Update opens the Stripe customer portal.

## Test teams for every plan

Four plan cases, three teams. A real paid Pro team would need real money, so the Pro and Comped cases are the same team: the comped Pro team.

| Case | QA user | Team id | Reads as |
|---|---|---|---|
| Free | 3411 (`state-free.json`) | `308dcc93-8076-4e30-a982-ae8b0df82cee` | Free, not comped, shared allowance |
| Pro and Comped | 3413 (`state-pro.json`) | `2ce0d9f8-4179-489d-bbce-2b0e197f8067` | Pro, comped until 2027-10-03 |
| Bring your own key | 3412 (`state-byok.json`) | `977c0c91-c14f-47b0-b8bc-933cc751f19d` | BYOK, comped until 2027-10-03, own key |

Run `.claude/skills/verify-qa/scripts/qa-teams` before a plan check. It first checks that each state file really is the listed user, then prints one health line per team: plan, comp date, allowance left, key source (Free shared, Pro managed, BYOK own key) and OK, MISMATCH, UNAVAILABLE or EXPIRED. Exit 0 means all three are healthy, 1 a mismatch or unavailable report, 3 an expired login (refresh it with the QA runner, see the account table in `SKILL.md`). It never changes a plan, comp date, key or payment. Its AI usage read is the same one the Settings AI usage page makes, which can also set the month's allowance baseline; do not run it in a loop. It accepts only the names `free`, `pro` and `byok`, refuses anything else. Paste its output into the QA proof.

Plan and comp changes are owner-only on the comp admin page, so a runner never resets them. If a line shows MISMATCH, tell HT Product Lead; do not try to fix it.

The spending cap on the BYOK team's saved key is not visible from the app, so it is not checked. The comp dates end on 2027-10-03, after which the lines show MISMATCH by design. The comped Pro team currently has no managed AI key source and the BYOK usage report fails with a 502, so both lines show MISMATCH or UNAVAILABLE until those are fixed. The health line is the API view; the effective plan shown to users is the Billing page, which the `plan-check` journey asserts. A BYOK line showing UNAVAILABLE means the app could not load that key's usage report.

## How to drive it

Use `~/.config/ht-qa/state-{free,byok,pro}.json`. Select each account's own private `QA runner board` before opening settings and verify the account owns its team.

1. Doctor: production deployment is successful and `/my-tasks` is signed in.
2. Open Billing and record current plan, seats, billing cycle, and payment-method controls. Reload and compare.
3. Click Manage, record the plan rows in the Plans card and monthly/yearly prices, and select the monthly BYOK upgrade on the Free account.
4. Wait for the server checkout endpoint to return a Stripe-hosted URL and the Stripe checkout page to render. Capture its product, amount, cadence and payment form without filling any payment field. Use Stripe's back/cancel link to return and confirm the plan did not change.
5. Open Billing again, click Update beside Payment method, and verify the Stripe customer portal renders. Return without changing anything.
6. Repeat the identical checkout and portal path after deployment and compare with the baseline. A changed amount, cadence, product, navigation, error, or missing payment form fails the money-path comparison.
7. Capture Billing and Plans at 1440x900 and 390x844. Check BYOK and Pro accounts without changing subscriptions; opening Plans as owner can still provision a Stripe customer if the team has none. For a strictly read-only run, use an already-linked team; if their Billing page says Free, compare with the recorded pre-existing baseline rather than treating a tier label as proof of a paid subscription.

## What usually breaks

- Settings selects the wrong team or upgrades are disabled for a non-owner.
- A team has no Stripe customer, checkout prices are not configured, or the checkout endpoint rejects an unsupported price.
- Checkout fails to navigate to Stripe, uses a removed client API, or loses the cancel return path.
- The portal endpoint fails or its return link is misconfigured.

## What proof to collect

Save a checklist before testing, account ids and expected tiers (never credentials), before/after Billing, Plans, Stripe checkout and portal screenshots, a short checkout video, endpoint status/host observations, cancellation result, and unchanged plan after reload. Include a phone screenshot and a desktop screenshot. Record unreachable paths with their exact reason. Never call a Stripe URL alone a successful checkout: the hosted page must render.

### Automated evidence

`node --test tests/settings-billing-active-plan.test.cjs` renders Billing and checks the active BYOK plan and monthly cadence despite an older canceled subscription row.
`node --test tests/stripe-checkout-authorization.test.cjs` checks checkout ownership, allowed prices and redirect URLs with mocked Stripe; neither test proves the hosted checkout or portal renders.

## Cleanup

Never enter card details, submit a payment, cancel a subscription, change a plan, edit billing data, or alter portal settings. Cancel only the uncompleted checkout via its back link. Before opening Plans, record whether the owned QA team already has a Stripe customer. If missing, Plans calls `POST /api/stripe/ensure-customer`, which creates a Stripe customer and saves the team linkage. Record any new linkage; do not delete the customer or clear billing data as cleanup. No task fixtures are required; all account writes stay within the test account's own team and QA runner board. Never use another person's account or a shared board. Any changed money path requires stopping and Supervisor Review, not Done.

## Start plan trial duration

The existing `htpr-7551-start-plan-checkout` eligibility flag must permit the QA identity before testing Start plan. Its default is Owner only; do not widen it or borrow owner credentials. Record an unavailable preview as UNREACHABLE with the actual refusal.

When eligible, open a Free owned board and check Start a Hypertask plan. The preview response's positive `trialDays` must match both the displayed “after N days” offer and Stripe's trial period. `htpr-7938-fourteen-day-trial` selects fourteen days for new offers, default Owner + QA; prior saved offers keep their original duration. A used trial must show no free-trial promise. Compare desktop and phone in all themes without submitting payment.

Switching the duration flag off must keep historical checkout reconciliation intact. Never fully revert the historical `start-plan` marker readers: completed checkouts still awaiting subscription visibility must block another checkout, including when their Redis reservation is gone. Use a duration-only rollback.

## Free ticket admission

For ticket-admission changes, do not enter checkout or change a plan. The existing `htpr-7686-free-plan-limits` rollout remains unchanged. `htpr-7923-unlimited-free-tickets` bypasses only ticket admission when enabled; Off restores the older admission path while the original rollout is enabled. Both default to Owner + QA.

Use an owned Free QA team or personal scope with at least 300 Normal tickets. Create a ticket from the app, Slack, AI chat and MCP/API; read it back after creation. Restore an archived ticket and move a ticket into the scope. Verify board and attachment limits still reject an over-limit write. Do not populate a customer board or change either switch for a live test. If the designated Free fixture cannot see both switches, record that exact flag limitation and cover the shared guard in CI instead of widening access. Existing rollback tests execute both branches at 350 tickets and preserve board/file refusals: `tests/htpr-7923-unlimited-free-tickets.test.cjs` and `tests/htpr-7686-free-plan-limits.test.cjs`.

Record the account, scope, existing ticket count, returned ticket identifiers and read-back results. Archive only test tickets created during this run. Slack or AI paths without configured credentials must be recorded as UNREACHABLE, not counted as exercised by a shared-guard unit test.

## Cancellation and failed-payment admission

`node --test tests/stripe-subscription-entitlement.test.cjs tests/failed-payment-plan-gate.test.cjs tests/htpr-7686-free-plan-limits.test.cjs tests/seat-billing-concurrency.test.cjs` covers scheduled cancellation retaining Pro, terminal and unpaid events becoming Free, replay, legitimate payment recovery, monthly/yearly updates, retained data and skipped seat billing. These tests exercise the real status policies with persistence/provider boundaries replaced; they do not prove Stripe delivery.

`htpr-7982-cancelled-free` aligns legacy board admission with the shared paid-access policy. Off retains legacy admission. Active, trialing, past_due, replacement paid subscriptions and explicit comps retain admission. The existing newer Free-plan rollout still bypasses that legacy precheck; do not alter either rollout to manufacture a live test.

Live QA remains read-only: record actual plan snapshots and reload persistence. A full cancellation or failed-payment event needs an authorized Stripe test-mode fixture, never a customer subscription. If unavailable, mark those paths UNREACHABLE and cite the behavioral suite as local evidence, not live proof. QA 985 may also bypass legacy admission through the newer Free-plan rollout; record that limitation explicitly.
