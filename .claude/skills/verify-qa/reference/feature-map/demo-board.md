# Demo board

## How a customer reaches it

The guest demo entry point (`/api/demo/guest`), unauthenticated, seeded with
sample tasks so a visitor can try the product without signing up.

## How to drive it

`e2e/smoke/demo.spec.ts` (`@demo` tag) creates its own unauthenticated
context and calls this directly; run it with `HT_QA_RUN_DEMO=1`. Don't run it
more than once per deploy: `/api/demo/guest` rate-limits at 5 guest creations
per IP per hour. Stay under that limit.

For the guest free-board signup flow (HTPR-7983), the guest entry is the
board the `@demo` context lands on. Desktop must show the AI chat panel open
on first load and the Sign up control in the board header; phone (390x844)
must show the Sign up button in the top bar and keep the board visible. Use
the same guest context for both widths: the entry point is rate limited.

## What usually breaks

Few demo-specific fixes on record. General hydration mismatches on first
paint ([HTPR-6609](https://app.hypertask.ai/detail/project-15/6609)) apply
here too, since the demo board is unauthenticated and hits the same
first-load code path as a fresh signed-out visit.
[HTPR-6199](https://app.hypertask.ai/detail/project-15/6199) is the smoke
test suite itself (see `e2e/smoke/README.md`), not a product bug; don't cite
it as a demo-board fix.

## What proof to collect

Screenshot the demo board immediately on load (no login prompt, sample tasks
visible), and confirm no console errors about hydration mismatch. For the
signup flow, also capture the phone top bar, and after email signup capture
the board it returns to with the chat panel open.

## Cleanup

None needed for a real guest session; guest boards are ephemeral by design.
Don't create more than one per hour (the rate limit above).
