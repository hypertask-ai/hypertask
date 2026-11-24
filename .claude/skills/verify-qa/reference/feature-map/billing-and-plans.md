# Billing and plans

## Sub-features

- `test-teams-for-every-plan` Test teams for every plan.
- `start-plan-trial-duration` Start plan trial duration.
- `free-ticket-admission` Free ticket admission.
- `cancellation-and-failed-payment-admission` Cancellation and failed-payment admission.
- `free-board-admission` Free board admission.
- `dedicated-billing-portal` Dedicated billing portal.
- `team-comp-admin` At `/admin/comp`, the feature-flag owner searches a team by id or name and sets or clears a Pro or BYOK comp through an end date. Anyone else gets a not-found page. Stripe subscriptions and charges stay as they are.
- `paid-checkout-thanks` Stripe sends the browser to `/full-plan-confirmation` with the checkout session. The page shows "Thank You for Upgrading!" Continue opens the open board, the previous board, or the onboarding screen.
- `internal-reset-tool` `/reset` asks for an admin password, then offers Reset User & Transfer Content and Reset Trial Period. The first moves one internal account's boards and teams onto another and resets the source. The second restarts a person's 14-day trial.
- `trial-paywall` An onboarded person whose trial is still unused can open `/trial` and sees a full-screen Choose Your Plan paywall. Anyone else is sent home.
- `trial-checkout-return` `/trial-plan-confirmation` shows Choose Trial Plan, or "Your Pro Plan trial is now active!" after a matching checkout. Anything else shows "Something Went Wrong".
- `plan-ai-caps` With `htpr-7324-plan-ai-caps` on for the team owner, included AI is $5 per paid seat each month, $2.50 per member on BYOK, and $1 a month plus $0.25 a day on Free. Off keeps the older $40 paid and $1 free monthly caps.
- `remaining-ai-spend` With `htpr-7394-remaining-ai-spend` on for the team owner, Slack and label batches and embeddings reserve spend against that cap, and native web search stays off on Hypertask keys.
- `internal-team-saved-plan` The internal team uses its saved subscription or comp for AI access, board admission, and the open board billing chip.
- `vercel-budget-alerts` With `htpr-8101-vercel-budget-alerts` on, a signed Vercel budget alert files one Urgent ticket and later alerts update that same ticket. At 100% the owner is emailed once.

## How to get to it (user POV)

- Open `/settings/billing` by URL. Inside the settings shell Billing is a row under the `Team` tab, so a `Billing` click before the `Team` click does nothing; the URL is the reliable path. A read-only check of this page is: open the URL, read the `Billing` heading and the `Plan`, `Seats`, `Billing cycle`, `Renewal`, `Next invoice` and `Invoice total` rows, and take a shot. All of those show at 1440x900 and at 390x844 alike.
- The seeded QA team is Free and not comped, so on that account `Billing cycle`, `Renewal`, `Next invoice` and `Invoice total` read `Free Plan` with `htpr-9529-comped-pro-billing` on or off. With the flag on, the same four rows read `Complimentary` for a comped team: the Pro and Comped team and the BYOK team in the table below, and the internal team named in `src/lib/internalCompTeams.ts`. Seeing `Complimentary` needs that comped account; the Free seed shows `Free Plan` either way.
- Plans is its own sidebar entry at `/settings/plans`, not the Manage subscription row. On phone the settings sidebar is hidden, so open `/settings/plans` by URL. `/pricing` is a legacy entry that defaults to Plans. Its `preSelect` query also routes `API Keys` to Bring your own key, `Billing` to Billing, `Members` to Team > Members, and `Settings` to Profile > General.
- `Manage` on the Manage subscription row and Update under Billing > Payment both open the Stripe customer portal and leave the app, so a read-only check presses neither. The portal card is titled **Payment**
  and its row shows the saved card (`src/components/Modals/Settings/BillingSection.tsx:401-413`).

### Test teams for every plan

Four plan cases, three teams. A real paid Pro team would need real money, so the Pro and Comped cases are the same team: the comped Pro team.

| Case | QA user | Team id | Reads as |
|---|---|---|---|
| Free | 3411 (`state-free.json`) | `308dcc93-8076-4e30-a982-ae8b0df82cee` | Free, not comped, shared allowance |
| Pro and Comped | 3413 (`state-pro.json`) | `2ce0d9f8-4179-489d-bbce-2b0e197f8067` | Pro, comped until 2027-10-03, shared key |
| Bring your own key | 3412 (`state-byok.json`) | `977c0c91-c14f-47b0-b8bc-933cc751f19d` | BYOK, comped until 2027-10-03, own key |

Run `.claude/skills/verify-qa/scripts/qa-teams` before a plan check. It first checks that each state file really is the listed user, then prints one health line per team: plan, comp date, allowance left, key source (Free shared, Pro shared, BYOK own key) and OK, MISMATCH, UNAVAILABLE or EXPIRED. Exit 0 means all three are healthy, 1 a mismatch or unavailable report, 3 an expired login (refresh it with the QA runner, see the account table in `SKILL.md`). It never changes a plan, comp date, key or payment. Its AI usage read is the same one the Settings AI usage page makes, which can also set the month's allowance baseline; do not run it in a loop. It accepts only the names `free`, `pro` and `byok`, refuses anything else. Paste its output into the QA proof.

Plan and comp changes are owner-only on the comp admin page, so a runner never resets them. If a line shows MISMATCH, tell HT Product Lead; do not try to fix it.

The spending cap on the BYOK team's saved key is not visible from the app, so it is not checked. The comp dates end on 2027-10-03, after which the lines show MISMATCH by design. A comped Pro team has no per-team key of its own: the comp grant funds it on the shared key with the same $5 per paid seat allowance as Pro (`HTPR-8009`), so its line reads `shared` and not `managed`. The BYOK usage report fails with a 502, so that line shows UNAVAILABLE. The health line is the API view; the effective plan shown to users is the Billing page, which the `plan-check` journey asserts. A BYOK line showing UNAVAILABLE means the app could not load that key's usage report.

### Team comps

Open `/admin/comp` while signed in. The feature-flag owner sees the title "Team comps" and a search labeled "Team ID or name". A UUID searches by team id. Any other text, from 2 to 100 characters, searches by name. One match opens that team. Several matches list up to 20, and the list says to narrow the name. The team panel shows current plan, comped plan, comped until, and Active, Expired, or Not comped. Comp plan is Pro or BYOK. End date is required and cannot be before today. It starts one year out. Set comp and Clear comp both say that Stripe subscriptions are unchanged. Clear comp stays disabled until a comp date exists. Anyone who is not the feature-flag owner gets a not-found page.

### Paid checkout thanks

Stripe returns a browser to `/full-plan-confirmation` with `session_id`. The page loads that checkout session's subscription and shows "Thank You for Upgrading!" plus the help address. Continue opens the board already open in the app. With no open board, it opens the previous board saved in the browser, including that board's view. With neither, it opens the onboarding screen.

### Internal reset tool

Open `/reset`. The first screen is "Admin Access" and asks for the password to the user reset tool. A wrong password says "Invalid password. Access denied." After the password, the heading is "Admin Tools" and the line under it is "Manage user accounts and trial periods". Two tabs follow: "Reset User & Transfer Content" and "Reset Trial Period".

Reset User lists a fixed set of internal accounts and filters them by name or email. Step 1 picks the account to reset. Step 2 picks a different account that receives the boards and teams. The review says the source account will be completely reset and that this cannot be undone. A confirmation comes before the transfer. Resetting the account you are signed in as signs that browser out.

Reset Trial Period searches any person by name or email, at least 2 characters. The selected person shows how many trial days are left, or "Trial expired". Reset Trial Period sets the trial unused and sets the join date to today, which starts the 14-day count again. A person with an active subscription is refused.

### Trial paywall

Open `/trial` while signed in and onboarded. The app allows it only when the trial has not been marked used. The screen is a full-screen "Choose Your Plan" paywall with the line "Choose a plan to continue organizing your projects and collaborating with your team." Clicking outside it does nothing. The close control goes back to the previous screen, or home when there is no previous screen. A person who is not onboarded is sent to onboarding before this page. A used trial, or a missing trial setting, is sent home.

### Trial checkout return

Open `/trial-plan-confirmation` while signed in. The page tries to create a Stripe customer when the team has none, then looks up the team from the query or from the signed-in user's own team. With a portal link, a Stripe customer on the user, and no checkout `session_id` or `success` flag, the heading is "Choose Trial Plan". The card stays empty until `htpr-7551-start-plan-checkout` is known. It then shows that flag's start-plan control, or the bring-your-own-key plan when the flag is off. After checkout, a session whose Stripe customer matches the signed-in user shows "Your Pro Plan trial is now active!" The line under it is "Checking plan access…" until the start-plan flag is known, then "Check your board for your current plan details" when that flag is on, otherwise "You have 14 days to test all Hypertask Pro Features". Let's Go opens the board already open in the app, the previous board, or the onboarding screen. Any other result shows "Something Went Wrong".

### Plan AI caps

`htpr-7324-plan-ai-caps` has no page of its own. It follows the team owner. On, included AI for a paid or comped Pro seat is $5 times the highest seat count seen that month. BYOK is $2.50 times the highest member count seen that month, with no daily cap. Free is $1 for the month and $0.25 for the day. A guest demo account keeps the free daily cap. Off, paid included AI stays $40 for the month and free stays $1 for the month, with no daily cap. A team that spends the month sees "This team has used its included AI allowance for this month. Upgrade or add your own AI key to continue." A team that spends the day sees "This team has used today's included AI allowance. Try again tomorrow, upgrade or add your own AI key."

### Remaining AI spend

`htpr-7394-remaining-ai-spend` has no page of its own. It follows the team owner and defaults to Owner + QA. On, a Slack thread summary or a smart label on a Hypertask key can use the half-price batch, and that batch reserves its estimate against the team cap until the month ends, then settles at half the normal price. A customer's own key does not take that batch path. An embedding on a BYOK team with its own key uses that key. A BYOK team without its own key, a team over its cap, or a team with nothing to charge uses keyword search instead of a Hypertask-paid vector call. A funded vector call reserves the embedding cost before the call. Native web search for Claude and OpenAI stays off when Hypertask is paying. Off, embeddings keep the previous path, shared-key batches stay off, and native web search can stay on.

### Internal team saved plan

The internal team named in `src/lib/internalCompTeams.ts` uses its saved subscription or comp for AI access and free-board admission. The open board billing chip does the same. A team id by itself does not grant Pro.

### Vercel budget alerts

`htpr-8101-vercel-budget-alerts` has no page of its own. It defaults to Owner + QA. Vercel posts a signed body to `POST /api/integrations/vercel/budget-alert`. On, the first alert for a budget, threshold, and scope files one Urgent ticket in Bugs on board 15 with the Infra label. The title is the scope, the percent, and the dollars spent of the budget. A later alert for that same marker comments on the ticket with the new percent and spend. At 100% or more, the owner is emailed once. Off, the webhook answers that it is off.

## Driving it with agent-browser

Use `~/.config/ht-qa/state-{free,byok,pro}.json`. Select each account's own private `QA runner board` before opening settings and verify the account owns its team.

1. Doctor: production deployment is successful and `/my-tasks` is signed in.
2. Open Billing and record current plan, seats, billing cycle, and payment-method controls. Reload and compare.
3. Click Manage, record the plan rows in the Plans card and monthly/yearly prices, and select the monthly BYOK upgrade on the Free account.
4. Wait for the server checkout endpoint to return a Stripe-hosted URL and the Stripe checkout page to render. Capture its product, amount, cadence and payment form without filling any payment field. Use Stripe's back/cancel link to return and confirm the plan did not change.
5. Open Billing again, click Update beside the saved card in the **Payment** card, and verify the Stripe customer portal renders. Return without changing anything.
6. Repeat the identical checkout and portal path after deployment and compare with the baseline. A changed amount, cadence, product, navigation, error, or missing payment form fails the money-path comparison.
7. Capture Billing and Plans at 1440x900 and 390x844. Check BYOK and Pro accounts without changing subscriptions; opening Plans as owner can still provision a Stripe customer if the team has none. For a strictly read-only run, use an already-linked team; if their Billing page says Free, compare with the recorded pre-existing baseline rather than treating a tier label as proof of a paid subscription.

### Team comps

Open `/admin/comp` on the QA account and record the not-found page. Do not sign in as the feature-flag owner to set or clear a comp. Proof that the form saves is `node --test tests/team-comp-admin-ui.test.cjs tests/team-comp-admin-route.test.cjs tests/team-comp.test.cjs`, which is not a live grant.

### Paid checkout thanks

Do not start a new checkout to reach `/full-plan-confirmation`. Record the thanks heading only when a QA checkout already returned there. Continue must land on a board or the onboarding screen, and the plan on Billing must match the plan from before the click.

### Internal reset tool

Open `/reset` and record the Admin Access password gate. Do not enter a password, search a person, or press either reset. A live reset transfers boards and teams or restarts a trial, and neither can be used as a check.

### Trial paywall

On the Free QA account, open `/trial` and record either the Choose Your Plan heading or the redirect home. Do not choose a plan. Choosing one can create a team and a Stripe customer.

### Trial checkout return

Do not start a trial checkout to reach `/trial-plan-confirmation`. Record UNREACHABLE unless a signed-in QA session is already on that return URL. Do not press Let's Go into a new checkout, and do not submit payment.

### Plan AI caps

Do not spend to the cap to prove `htpr-7324-plan-ai-caps`. Run `.claude/skills/verify-qa/scripts/qa-teams` once and keep the health lines. The amounts and the strict fallback are `node --test tests/htpr-7324-plan-ai-caps.test.cjs tests/htpr-7324-demo-caps.test.cjs`.

### Remaining AI spend

Do not run a Slack summary, a smart label, or an embedding to prove `htpr-7394-remaining-ai-spend`. The hold, the keyword fallback, and native search are `node --test tests/htpr-7394-remaining-spend.test.cjs`.

### Internal team saved plan

Leave the internal team's plan untouched. Saved subscription, comp, and an empty saved plan are `node --test tests/htpr-7852-internal-team-saved-plan.test.cjs`.

### Vercel budget alerts

Do not post a body to the Vercel budget webhook. There is no screen to open. Filing, the comment update, and the one owner email are `node --test tests/htpr-8101-vercel-budget-alert.test.cjs`.

### Hands-free drive on production

```bash
node .claude/skills/verify-qa/scripts/feature-map-drive.mjs billing-and-plans --dir /tmp/feature-map-drive
```

Prints `PASS` or `FAIL` per step, writes `result.json` and screenshots into `--dir`, and ends with
`billing-and-plans ok`. It refuses any base except `https://app.hypertask.ai`, uses the `qa-login` identities,
creates only fixtures its own cleanup removes, and never prints a cookie, token or email address.

## Gotchas

- Settings selects the wrong team or upgrades are disabled for a non-owner.
- A team has no Stripe customer, checkout prices are not configured, or the checkout endpoint rejects an unsupported price.
- Checkout fails to navigate to Stripe, uses a removed client API, or loses the cancel return path.
- The portal endpoint fails or its return link is misconfigured.

### What proof to collect

Save a checklist before testing, account ids and expected tiers (never credentials), before/after Billing, Plans, Stripe checkout and portal screenshots, a short checkout video, endpoint status/host observations, cancellation result, and unchanged plan after reload. Include a phone screenshot and a desktop screenshot. Record unreachable paths with their exact reason. Never call a Stripe URL alone a successful checkout: the hosted page must render.

### Automated evidence

`node --test tests/settings-billing-active-plan.test.cjs` renders Billing and checks the active BYOK plan and monthly cadence despite an older canceled subscription row.
`node --test tests/stripe-checkout-authorization.test.cjs` checks checkout ownership, allowed prices and redirect URLs with mocked Stripe; neither test proves the hosted checkout or portal renders.

### Cleanup

Never enter card details, submit a payment, cancel a subscription, change a plan, edit billing data, or alter portal settings. Cancel only the uncompleted checkout via its back link. Before opening Plans, record whether the owned QA team already has a Stripe customer. If missing, Plans calls `POST /api/stripe/ensure-customer`, which creates a Stripe customer and saves the team linkage. Record any new linkage; do not delete the customer or clear billing data as cleanup. No task fixtures are required; all account writes stay within the test account's own team and QA runner board. Never use another person's account or a shared board. Any changed money path requires stopping and Supervisor Review, not Done.

### Start plan trial duration

The existing `htpr-7551-start-plan-checkout` eligibility flag must permit the QA identity before testing Start plan. Its default is Owner only; do not widen it or borrow owner credentials. Record an unavailable preview as UNREACHABLE with the actual refusal.

When eligible, open a Free owned board and check Start a Hypertask plan. The preview response's positive `trialDays` must match both the displayed “after N days” offer and Stripe's trial period. `htpr-7938-fourteen-day-trial` selects fourteen days for new offers, default Owner + QA; prior saved offers keep their original duration. A used trial must show no free-trial promise. Compare desktop and phone in all themes without submitting payment.

Switching the duration flag off must keep historical checkout reconciliation intact. Never fully revert the historical `start-plan` marker readers: completed checkouts still awaiting subscription visibility must block another checkout, including when their Redis reservation is gone. Use a duration-only rollback.

### Free ticket admission

For ticket-admission changes, do not enter checkout or change a plan. The existing `htpr-7686-free-plan-limits` rollout remains unchanged. `htpr-7923-unlimited-free-tickets` bypasses only ticket admission when enabled; Off restores the older admission path while the original rollout is enabled. Both default to Owner + QA.

Use an owned Free QA team or personal scope with at least 300 Normal tickets. Create a ticket from the app, Slack, AI chat and MCP/API; read it back after creation. Restore an archived ticket and move a ticket into the scope. Verify attachment limits still reject an over-limit write. Board admission remains limited unless `htpr-7922-unlimited-free-boards` is also enabled. Do not populate a customer board or change either switch for a live test. If the designated Free fixture cannot see both switches, record that exact flag limitation and cover the shared guard in CI instead of widening access. Existing rollback tests execute both branches at 350 tickets and preserve board/file refusals: `tests/htpr-7923-unlimited-free-tickets.test.cjs` and `tests/htpr-7686-free-plan-limits.test.cjs`.

Record the account, scope, existing ticket count, returned ticket identifiers and read-back results. Archive only test tickets created during this run. Slack or AI paths without configured credentials must be recorded as UNREACHABLE, not counted as exercised by a shared-guard unit test.

### Cancellation and failed-payment admission

`node --test tests/stripe-subscription-entitlement.test.cjs tests/failed-payment-plan-gate.test.cjs tests/htpr-7686-free-plan-limits.test.cjs tests/seat-billing-concurrency.test.cjs` covers scheduled cancellation retaining Pro, terminal and unpaid events becoming Free, replay, legitimate payment recovery, monthly/yearly updates, retained data and skipped seat billing. These tests exercise the real status policies with persistence/provider boundaries replaced; they do not prove Stripe delivery.

`htpr-7982-cancelled-free` aligns legacy board admission with the shared paid-access policy. Off retains legacy admission. Active, trialing, past_due, replacement paid subscriptions and explicit comps retain admission. The existing newer Free-plan rollout still bypasses that legacy precheck; do not alter either rollout to manufacture a live test.

Live QA remains read-only: record actual plan snapshots and reload persistence. A full cancellation or failed-payment event needs an authorized Stripe test-mode fixture, never a customer subscription. If unavailable, mark those paths UNREACHABLE and cite the behavioral suite as local evidence, not live proof. QA 985 may also bypass legacy admission through the newer Free-plan rollout; record that limitation explicitly.

### Free board admission

`htpr-7922-unlimited-free-boards` removes only board admission within the existing Free-plan rollout. Both switches remain Owner + QA. Off restores the two-board cap without deleting existing boards; the legacy three-board rule remains when the original rollout is Off.

On an owned Free QA scope with both switches enabled, create the third and twentieth board through the app and MCP/API; read each back after creation. Restore an empty archived test board. Check Slack and AI board creation only with configured QA integrations; otherwise record UNREACHABLE with the reason. Verify a ticket or attachment refusal still applies when its respective bypass is Off. Never alter a rollout or plan to manufacture a live path.

Settings > Team > Plans must show Unlimited boards, retaining the correct ticket and file lines. Capture desktop and phone in all themes, reload, and compare paid plan prices against baseline. Archive only boards created during this run.

### Dedicated billing portal

`htpr-7980-stripe-portal-billing` defaults to Owner + QA because it changes billing. The existing Billing section shows one plan card when available. An unsubscribed Free owner can open checkout; any Stripe-linked customer can use the dedicated portal, including Free or canceled teams. Other members cannot launch either action. Flag off preserves existing controls. Missing, unready, or rejected portal configuration restores existing controls.

Readiness checks the authenticated user, ticket flag, and live dedicated configuration policy without creating a session. Provider errors retain existing controls. The server checks ownership and the ticket flag. Checkout refuses existing subscriptions, pending completed checkouts, and complimentary teams. The dedicated portal requires `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` and validates price-only changes, period-end cancellation, prorations, continued trials, unchanged billing anchors and no quantity editing. Configuration and live payment verification remain separate release steps; do not create Stripe resources during verification without approval.

### Team comps, reset, trial, and checkout returns

`/admin/comp` is not-found for everyone except the feature-flag owner. Setting or clearing a comp writes the team and must not be done from QA. `/reset` can transfer every board and team on an internal account, or mark a trial unused, and the password must not be entered. `/trial` is not read-only for a person with no team: the paywall creates a team and a Stripe customer when a plan is chosen. `/full-plan-confirmation` and `/trial-plan-confirmation` are return URLs. The paid thanks heading still shows when the checkout session has no subscription. The trial return shows Choose Trial Plan, the active-trial heading, or "Something Went Wrong". Do not invent a `session_id`.

### Plan AI caps

If the flag check throws and the owner can still be read, `htpr-7324-plan-ai-caps` caps the month at the old $40 or $1 amount. If the owner cannot be read at all, the allowance falls back to $1 for the month and $0.25 for the day. Do not describe either failure as the normal $5 seat cap. Off is the old monthly cap with no daily cap. Do not turn the flag off on a live team to watch the cap change.

### Remaining AI spend

`htpr-7394-remaining-ai-spend` defaults to Owner + QA. A customer key never enters the half-price batch. Keyword search is the embedding result when the team is over the cap or BYOK has no own key. That is not a failed search. Do not turn the flag off to force a Hypertask-paid embedding.

### Internal team saved plan

The internal team uses its saved plan for AI access, board admission, and the open board billing chip. Checkout and other plan reads that never used this switch still treat that team as Pro. A Billing page on any other team does not show this. Do not change the internal team's saved plan to prove it.

### Vercel budget alerts

`htpr-8101-vercel-budget-alerts` does nothing until the webhook secret is set. A missing secret answers that the webhook is not configured, before the flag is read. A bad signature is refused. Off answers that the webhook is off. A second delivery for the same spend must not file a second ticket. Do not point Vercel at a preview, and do not post a signed or unsigned payload from QA.
