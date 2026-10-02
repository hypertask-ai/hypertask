# Billing and plans

## How a customer reaches it

- Sign in, open an owned board, then Settings > Team > Billing (`/settings/billing`).
- Click Manage subscription to reach Plans (`/settings/plans`); `/pricing` is a legacy entry that redirects to Plans.
- Billing > Payment method > Update opens the Stripe customer portal.

## How to drive it

Use `~/.config/ht-qa/state-{free,byok,pro}.json`. Select each account's own private `QA runner board` before opening settings and verify the account owns its team.

1. Doctor: production deployment is successful and `/my-tasks` is signed in.
2. Open Billing and record current plan, seats, billing cycle, and payment-method controls. Reload and compare.
3. Click Manage, record the plan cards and monthly/yearly prices, and select the monthly BYOK upgrade on the Free account.
4. Wait for the server checkout endpoint to return a Stripe-hosted URL and the Stripe checkout page to render. Capture its product, amount, cadence and payment form without filling any payment field. Use Stripe's back/cancel link to return and confirm the plan did not change.
5. Open Billing again, click Update beside Payment method, and verify the Stripe customer portal renders. Return without changing anything.
6. Repeat the identical checkout and portal path after deployment and compare with the baseline. A changed amount, cadence, product, navigation, error, or missing payment form fails the money-path comparison.
7. Capture Billing and Plans at 1440x900 and 390x844. Check BYOK and Pro accounts read-only; if their Billing page says Free, compare with the recorded pre-existing baseline rather than treating a tier label as proof of a paid subscription.

## What usually breaks

- Settings selects the wrong team or upgrades are disabled for a non-owner.
- A team has no Stripe customer, checkout prices are not configured, or the checkout endpoint rejects an unsupported price.
- Checkout fails to navigate to Stripe, uses a removed client API, or loses the cancel return path.
- The portal endpoint fails or its return link is misconfigured.

## What proof to collect

Save a checklist before testing, account ids and expected tiers (never credentials), before/after Billing, Plans, Stripe checkout and portal screenshots, a short checkout video, endpoint status/host observations, cancellation result, and unchanged plan after reload. Include a phone screenshot and a desktop screenshot. Record unreachable paths with their exact reason. Never call a Stripe URL alone a successful checkout: the hosted page must render.

## Cleanup and safety

Never enter card details, submit a payment, cancel a subscription, change a plan, edit billing data, or alter portal settings. Cancel only the uncompleted checkout via its back link. No task fixtures are required; all account writes stay within the test account's own team and QA runner board. Never use another person's account or a shared board. Any changed money path requires stopping and Supervisor Review, not Done.
