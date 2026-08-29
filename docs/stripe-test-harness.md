# Stripe test-mode billing harness

**Use this harness to verify seat billing with fake Stripe money without touching Hypertask application data.** It refuses live Stripe keys, runs the real seat-billing decision path with isolated in-memory team state, and removes every deletable Stripe fixture after each run.

## One-time setup

Install the official Stripe CLI and verify it:

```bash
stripe version
```

Keep local values in `.env.local`; never commit them. The file must contain the test-mode `STRIPE_SECRET_KEY` and the temporary `WEBHOOK_SECRET_STRIPE` printed by `stripe listen`. The billing harness does not read or write the application database.

## Forward test webhooks

In terminal one:

```bash
npm run stripe:listen
```

Copy the printed `whsec_...` value into `.env.local` as `WEBHOOK_SECRET_STRIPE`, then run the development server in terminal two without starting a second listener:

```bash
npx next dev
```

## Run the seat scenarios

```bash
STRIPE_HARNESS_ENV_FILE=.env.local \
STRIPE_HARNESS_CONFIRM=I_UNDERSTAND_TEST_ONLY \
npm run billing:harness
```

The harness creates an isolated test customer, a €20/month test seat price, and a five-seat subscription. It injects in-memory team state into the real `syncSeatBillingOnJoin` function, then checks:

- six accepted seats produce one Stripe quantity update and an invoice whose credit/charge lines all use the subscription's €20/month price, with a positive net proration that never exceeds one monthly unit;
- adding a seventh accepted seat while the team is comped produces no quantity change and no invoice;
- Stripe customer/subscription records are deleted by their deterministic run marker, including after a lost create response, failed assertion, or handled SIGINT/SIGTERM interruption;
- Stripe requires used prices/products and invoice/payment records to remain in test history. During cleanup, the harness archives the catalog records and tags every retained invoice for each discovered test customer with its unique `run_id`, including after failed or interrupted runs; these records never represent real funds.

If a run reports incomplete cleanup, use the printed error to remove only the `HTPR-4848` test-mode resources before rerunning.
