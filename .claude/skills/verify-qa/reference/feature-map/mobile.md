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
`HT_QA_JOURNEYS=1`. They are not part of `prod-health.yml`'s CI job (that
job only runs the read-only `prod.spec.ts` checks). Reading the `@mobile`
test bodies is still the fastest way to see what "normal" looks like, just
don't assume they ran automatically. For the session's own proof, shoot
production with `phone-shot.sh` and `--state`.

For the New Task title, open a sandbox board at 390x844, press `C`, expand
`Title: Add`, then tap the title field, type and save. Check the textarea itself
has height >=24px and `elementFromPoint` at its centre hits it; the
`htpr-6556-mobile-description-first` layout allowance must not mask a collapsed
input. Repeat on desktop to check
the unchanged desktop path (https://app.hypertask.ai/detail/project-15/6970).

For description-only New Task creation (`/new?id=<private QA board>`), leave the
title empty, enter a description, and save. Under `htpr-8031-auto-title`, the
`/api/ai/task-writer` request carries `requestKind: "auto-title"`; a title-only
reply is valid, but a full task draft still needs a description. Check the saved
title and original description after reload on iPhone-sized, Android-sized and
desktop viewports. Repeat with a manual title and confirm it stays unchanged.
Intercept only the title request with a 503 in a separate browser context to
prove saving uses the first 80 description characters and shows the fallback
notice. This injected failure proves recovery, not live provider health. Never
change shared provider settings. Delete only this run's QA fixtures.

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
