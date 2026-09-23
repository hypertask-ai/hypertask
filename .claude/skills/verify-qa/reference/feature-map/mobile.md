# Mobile

## How a customer reaches it

Any route at a phone viewport. Not a separate app; same routes, same code,
different layout below the responsive breakpoint.

## How to drive it

Real 390x844 phone-viewport screenshot, never a resized desktop window:
```
.claude/skills/verify-on-phone/scripts/phone-shot.sh https://app.hypertask.ai/<path> <out.png>
```
`e2e/smoke/journeys.spec.ts` tests tagged `@mobile` (`open-board`,
`open-task`, `create-task`) exercise the same shape, but only when
`hypertask-qa-runner` runs them with `HT_QA_JOURNEYS=1`; they are not part of
`prod-health.yml`'s CI job (that job only runs the read-only `prod.spec.ts`
checks). Reading the `@mobile` test bodies is still the fastest way to see
what "normal" looks like, just don't assume they ran automatically.

## What usually breaks

Mobile-only layout and interaction bugs desktop testing never catches, most
recently: mobile Task Writer direct save locking up and new-task layout
([HTPR-6564](https://app.hypertask.ai/detail/project-15/6564), two rounds), mobile Agent Chat chrome and composer showing on
the wrong path ([HTPR-6476](https://app.hypertask.ai/detail/project-15/6476), two rounds), mobile creator focus
initialization order ([HTPR-6556](https://app.hypertask.ai/detail/project-15/6556)), mobile Agent Chat layout/mic/reply style
([HTPR-6407](https://app.hypertask.ai/detail/project-15/6407)), and the shortcut nudge not showing on mobile task pages
([HTPR-5906](https://app.hypertask.ai/detail/project-15/5906)). This area has a long tail of past mobile-only fixes; grep
`git log --oneline | grep -i 'BUGFIX.*mobile'` for the full list if a ticket
needs older context.

## What proof to collect

The real phone-width screenshot itself is the proof; a desktop-width
screenshot is not evidence for a mobile ticket, full stop (this cost a real
regression once, see `verify-on-phone/SKILL.md`). Reload after any state
change and reshoot to confirm it held at that viewport.

## Cleanup

Same as whichever underlying area you were testing (task, comment, board);
mobile isn't a separate data surface.
