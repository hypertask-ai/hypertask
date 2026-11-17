# Demo board

## Sub-features

- `demo-board` Demo board.
- `demo-entry` Open `/demo` while signed out. The page shows "Creating your private demo board…", POSTs `/api/demo/guest`, and sends the browser to the returned board URL. A failed create shows the error and a Try again button.
- `learn-board` Open `/learn` while signed in. The page shows "Preparing your tutorial board…", reads a `previousBoard` cookie when one is present, and POSTs `/api/learn/board`. Success sends the browser to the returned board URL. The API currently answers 410, "The keyboard shortcuts tutorial is temporarily unavailable", and the page shows that text with Try again. Signed out, the API answers 401, "Sign in to start the tutorial".
- `onboarding-wizard` A signed-in person opens `/onboarding`. A new account sees "Set up your workspace", then "What will you use Hypertask for?", then "Which AI will you drive Hypertask with?". A `companySize` query of Just me skips "Invite co-workers to your team". The last screen says "You're all set." and Launch Hypertask. A `resumeKey` query jumps to the screen with that key. An account that is not new sees the AI screen, then Launch Hypertask.
- `tutorial-landing` Open `/interactive-onboarding/landing`. A signed-in person who is not already on the tutorial is replaced onto `/interactive-onboarding/landing?scene=0`. The screen is a sample board. Scene 0 blurs that board and shakes once a second until Enter. A signed-out visitor who is not in the funnel leaves the tutorial.
- `tutorial-inbox` Open `/interactive-onboarding/inbox`. Below scene 17 the page shows the sample notification list. At scene 13, J moves the highlight down, K moves it up, and E removes the highlighted row. Scene 18 shows the inbox-zero state.
- `tutorial-task` Open `/interactive-onboarding/taskDetail`. The page shows the sample task title, description, and comments. At scene 15, E advances. At scene 17, Enter on tomorrow returns to the sample inbox.
- `tutorial-end` Open `/interactive-onboarding/end`. The page shows "Well Done!" and "All updates processed." The footer says to hit enter. Enter leaves the tutorial only at scene 33. With `funnel_completed` set, the page marks the tutorial complete and shows "Let's get your team setup!" plus the login button.

## How to get to it (user POV)

The guest demo entry point (`/api/demo/guest`), unauthenticated, seeded with
sample tasks so a visitor can try the product without signing up.

### Demo, learn, and onboarding pages

`/demo` is the public guest entry and needs no account. `/learn` prepares a "Learn Hypertask" board for the signed-in account. `/onboarding` is the signed-in setup wizard. The interactive pages are `/interactive-onboarding/landing`, `/interactive-onboarding/inbox`, `/interactive-onboarding/taskDetail`, and `/interactive-onboarding/end`. One layout keeps the scene index across those four URLs. Scene 12 on the landing page is G then I, and that move opens the inbox URL. The `scene` query is written when the scene changes. A fresh load resets the scene index to 0.

## Driving it with agent-browser

`e2e/smoke/demo.spec.ts` (`@demo` tag) creates its own unauthenticated
context and calls this directly; run it with `HT_QA_RUN_DEMO=1`. Don't run it
more than once per deploy: `/api/demo/guest` rate-limits at 5 guest creations
per IP per hour. Stay under that limit.

For the guest free-board signup flow (HTPR-7983), the guest entry is the
board the `@demo` context lands on. Desktop must show the AI chat panel open
on first load and the Sign up control in the board header; phone (390x844)
must show the Sign up button in the top bar and keep the board visible. Use
the same guest context for both widths: the entry point is rate limited.

Open `/demo` in a fresh signed-out context and wait for the board URL. Open `/learn` as QA 985 and record the alert text while the tutorial API returns 410. Open `/onboarding` as a signed-in account and record which heading is on screen. In one signed-in tab, open `/interactive-onboarding/landing` and record the sample board, then open `/interactive-onboarding/inbox` and record the sample notification list, then open `/interactive-onboarding/taskDetail` and record the sample task title, then open `/interactive-onboarding/end` and record "Well Done!". Open `/interactive-onboarding/end?funnel_completed=true` and record "Let's get your team setup!". Do not invent a second guest board in the same hour.

## Gotchas

Few demo-specific fixes on record. General hydration mismatches on first
paint ([HTPR-6609](https://app.hypertask.ai/detail/project-15/6609)) apply
here too, since the demo board is unauthenticated and hits the same
first-load code path as a fresh signed-out visit.
[HTPR-6199](https://app.hypertask.ai/detail/project-15/6199) is the smoke
test suite itself (see `e2e/smoke/README.md`), not a product bug; don't cite
it as a demo-board fix.
- `/learn` still renders, then shows the API error, while the keyboard shortcut tutorial is switched off.
- `/interactive-onboarding/end` without `funnel_completed` is the "Well Done!" screen. The same path with `funnel_completed` is the team-setup screen. Check the query before judging the heading.
- A signed-out visitor who is not in the funnel cannot stay on the interactive tutorial.
- J, K, and E on the sample inbox apply at scene 13. A fresh load is scene 0, so those keys do not archive on first paint.

### What proof to collect

Screenshot the demo board immediately on load (no login prompt, sample tasks
visible), and confirm no console errors about hydration mismatch. For the
signup flow, also capture the phone top bar, and after email signup capture
the board it returns to with the chat panel open. For `/learn`, capture the alert or the "Learn Hypertask" board URL. For `/onboarding`, capture the heading. For the interactive pages, capture the sample board, the sample inbox, the sample task, and the end heading.

### Cleanup

None needed for a real guest session; guest boards are ephemeral by design.
Don't create more than one per hour (the rate limit above).
