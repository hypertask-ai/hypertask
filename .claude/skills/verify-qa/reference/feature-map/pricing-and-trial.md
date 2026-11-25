# Pricing and trial

## Sub-features

- `pricing-redirect` Pricing and trial surface.
- `trial-paywall` Pricing and trial surface.
- `checkout-returns` Pricing and trial surface.

## How to get to it (user POV)

`/pricing` legacy entry routes into Plans (`src/app/pricing/page.tsx`, `billing-and-plans.md`). `/trial` is the paywall; `/trial-plan-confirmation` and `/full-plan-confirmation` are checkout returns.

## Driving it with agent-browser

`agent-browser` or `ht-verify`, headless, `https://app.hypertask.ai/...?realtime=on`, QA state `~/.config/hypertask-videos/storageState-qa.json`.

Signed in as QA 985, open `/pricing` and confirm redirect into `/settings/plans`. Open `/trial` and record **Choose Your Plan** or redirect home when trial is used. Do not choose a plan or enter payment. Record checkout return URLs as UNREACHABLE without an in-flight session.

## Gotchas

Trial choice can create Stripe customers. Reset and comp tools are on `admin-and-owner-tools.md`.

### What proof to collect

Screenshot the primary heading and one representative control at 1440x900 and 390x844 when the layout differs. Save the URL, account, and flag mode when a flag gates the control.

### Cleanup

Archive or delete only fixtures this check created. Leave production boards unchanged on read-only passes.
