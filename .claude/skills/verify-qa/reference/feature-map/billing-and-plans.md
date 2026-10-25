# Billing and plans

## How a customer reaches it

- Sign in, open an owned board, then Settings > Team > Billing (`/settings/billing`).
- Click Manage subscription to reach Plans (`/settings/plans`); `/pricing` is a legacy entry that defaults to Plans. Its `preSelect` query also routes `API Keys` to Bring your own key, `Billing` to Billing, `Members` to Team > Members, and `Settings` to Profile > General.
- Billing > Payment method > Update opens the Stripe customer portal.

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
