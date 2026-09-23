# Demo board

## How a customer reaches it

The guest demo entry point (`/api/demo/guest`), unauthenticated, seeded with
sample tasks so a visitor can try the product without signing up.

## How to drive it

`e2e/smoke/demo.spec.ts` (`@demo` tag) creates its own unauthenticated
context and calls this directly; run it with `HT_QA_RUN_DEMO=1`. Don't run it
more than once per deploy: `/api/demo/guest` rate-limits at 5 guest creations
per IP per hour, and the QA runner is responsible for staying under that.

## What usually breaks

- Smoke/hydration failures around initial demo load ([HTPR-6199](https://app.hypertask.ai/detail/project-15/6199), two rounds:
  "select a runnable smoke fixture", "remove smoke hydration failures").
- General hydration mismatches on first paint ([HTPR-6609](https://app.hypertask.ai/detail/project-15/6609), [HTPR-6585](https://app.hypertask.ai/detail/project-15/6585))
  apply here too, since the demo board is unauthenticated and hits the same
  first-load code path as a fresh signed-out visit.

## What proof to collect

Screenshot the demo board immediately on load (no login prompt, sample tasks
visible), and confirm no console errors about hydration mismatch.

## Cleanup

None needed for a real guest session; guest boards are ephemeral by design.
Don't create more than one per hour (the rate limit above).
