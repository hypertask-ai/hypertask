# Demo board

## Sub-features

- `demo-board` Demo board.
- `demo-entry` Open `/demo` while signed out. The page shows "Creating your private demo board…", POSTs `/api/demo/guest`, and sends the browser to the returned board URL. A failed create shows the error and a Try again button.
- `learn-board` **Verified-unreachable** while the keyboard shortcut tutorial is off (`KEYBOARD_SHORTCUT_TUTORIAL_ENABLED = false`): `src/proxy.ts` (`isKeyboardShortcutTutorialPath`) redirects `/learn` before the page renders. Signed out it 307s to `/login`; signed in it 307s to the previous board (`/project?id=<id>`). The `/learn` page's own 410 alert never shows. Signed-out `POST /api/learn/board` answers 401 `Sign in to start the tutorial`, which needs a cookie-free client (curl or the changed test). The verifier drives every request signed in as QA 985, so the one API check it can make here is the signed-in 410 `The keyboard shortcuts tutorial is temporarily unavailable`. Prerequisite to reach the page: the tutorial switched on in `src/lib/tutorial/keyboardShortcutTutorial.ts`.
- `onboarding-wizard` A signed-in person opens `/onboarding`. `?resumeKey=connect-ai-screen` shows "Which AI will you drive Hypertask with?"; `?resumeKey=launch-screen` shows "You're all set." and Launch Hypertask (both verified live). A `companySize` query of Just me skips "Invite co-workers to your team". A new account starts at "Set up your workspace".
- `tutorial-landing` **Verified-unreachable**, same prerequisite: the proxy sends every signed-in `/interactive-onboarding/*` request to the previous board, and a signed-out visitor to `/login`. No scene renders today.
- `tutorial-inbox` **Verified-unreachable**, same prerequisite. When the tutorial is on, the sample inbox is below scene 17, and E at scene 13 only fires after `j j k k` (E before that only shakes the hint).
- `tutorial-task` **Verified-unreachable**, same prerequisite. The page renders the sample task only with the tutorial on; at scene 15 E advances, at scene 17 Enter on tomorrow returns to the sample inbox.
- `tutorial-end` **Verified-unreachable**, same prerequisite. With `funnel_completed` the page would show "Let's get your team setup!" plus the login button; without it, "Well Done!".

## How to get to it (user POV)

The guest demo entry point (`/api/demo/guest`), unauthenticated, seeded with
sample tasks so a visitor can try the product without signing up.

### Demo, learn, and onboarding pages

`/demo` is the public guest entry and needs no account. `/learn` prepares a "Learn Hypertask" board for the signed-in account. `/onboarding` is the signed-in setup wizard. The interactive pages are `/interactive-onboarding/landing`, `/interactive-onboarding/inbox`, `/interactive-onboarding/taskDetail`, and `/interactive-onboarding/end`. One layout keeps the scene index across those four URLs. Scene 12 on the landing page is G then I, and that move opens the inbox URL. The `scene` query is written when the scene changes. A fresh load resets the scene index to 0.

## Driving it with agent-browser

`e2e/smoke/demo.spec.ts` (`@demo` tag) creates its own unauthenticated
context; run it with `HT_QA_RUN_DEMO=1`. Don't run it more than once per
deploy: `/api/demo/guest` rate-limits at 5 guest creations per IP per rolling
hour, and one guest is also capped at 3 regenerations per hour. Stay under both.

Verified on production 2026-11-20:

1. In a fresh signed-out context open `/demo`. Expect the transition text then
   one `POST /api/demo/guest` 200 and a board URL `/project?id=<n>`. The board
   shows four seeded cards: `Press Ctrl+K: every action is one keystroke away`,
   `Ask the AI to build this board for you`, `Hypertask CLI`, `Hypertask MCP`.
   No hydration-mismatch console error. That is the only guest creation; never
   reload `/demo` or press Try again.
2. The HTPR-7983 signup flow (AI chat auto-open on first load, phone top-bar
   Sign up, desktop `Sign up for free`) is Owner + QA only
   (`htpr-7983-free-mode-signup`), so a plain guest cannot prove it. Record it
   unreachable with that flag as the prerequisite; do not create a second guest
   board to chase it.
3. Signed out, `curl -s -o /dev/null -D - /learn` gives 307 `/login`, and
   `curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type:
   application/json' -d '{}' /api/learn/board` gives 410. Signed in as QA 985,
   `/learn` 307s to `/project?id=<previousBoard>` and no alert renders.
4. Open `/onboarding?companySize=Just%20me&resumeKey=connect-ai-screen`: the
   only heading is `Which AI will you drive Hypertask with?`. Then
   `/onboarding?resumeKey=launch-screen`: heading `You're all set.` and button
   `Launch Hypertask`.
5. Every `/interactive-onboarding/{landing,inbox,taskDetail,end}` URL 307s a
   signed-in visitor to the previous board. Record `verified-unreachable: the
   keyboard shortcut tutorial is disabled` with the route attempted, rather
   than claiming a scene check.
6. If the tutorial is enabled later, drive landing at `?scene=0` (sample board,
   hint shakes once a second), `g` then `i` to reach `/inbox?scene=13`, then
   `j j k k e e` to remove one notification row, then taskDetail and end.
   `funnel_completed=true` on end switches the heading to "Let's get your team
   setup!".

### Hands-free drive on production

```bash
node .claude/skills/verify-hypertask/scripts/feature-map-drive.mjs demo-board --dir /tmp/feature-map-drive
```

Prints `PASS` or `FAIL` per step, writes `result.json` and screenshots into `--dir`, and ends with
`demo-board ok`. It refuses any base except `https://app.hypertask.ai`, makes one guest board per run
inside the 5-per-hour cap, and never prints a cookie, token or email address.

## Gotchas

Few demo-specific fixes on record. General hydration mismatches on first
paint ([HTPR-6609](https://app.hypertask.ai/detail/project-15/6609)) apply
here too, since the demo board is unauthenticated and hits the same
first-load code path as a fresh signed-out visit.
[HTPR-6199](https://app.hypertask.ai/detail/project-15/6199) is the smoke
test suite itself (see `e2e/smoke/README.md`), not a product bug; don't cite
it as a demo-board fix.
- `/learn` and `/interactive-onboarding/*` are redirected by the proxy while the keyboard shortcut tutorial is off; the pages' own copy (410 alert, scenes) is not reachable.
- `/learn`'s API returns 401 to signed-out callers, and a signed-in caller still receives 410 while the keyboard shortcut tutorial is off. The verifier always sends its QA session cookie, so a planned signed-out 401 step can only come back 410: plan the signed-in 410 and leave the 401 to the changed test.
- `/interactive-onboarding/end` without `funnel_completed` is the "Well Done!" screen. The same path with `funnel_completed` is the team-setup screen. Check the query before judging the heading.
- With the tutorial on, J, K, and E on the sample inbox apply at scene 13, and E needs `j j k k` first. A fresh load is scene 0, so those keys do nothing on first paint.
- A signed-out visitor who is not in the funnel cannot stay on the interactive tutorial.

### What proof to collect

Screenshot the demo board immediately on load (no login prompt, sample tasks
visible), and confirm no console errors about hydration mismatch. The HTPR-7983
phone top bar and chat auto-open need `htpr-7983-free-mode-signup`; record them
unreachable for a plain guest instead of screenshotting the wrong state. For
`/learn`, record the 307 and the signed-in 410 API body; the signed-out 401
needs a cookie-free client and is proved by the changed test instead. For `/onboarding`, capture the
heading. For `/interactive-onboarding/*`, record the redirect and the
disabled-tutorial prerequisite.

### Cleanup

None needed for a real guest session; guest boards are ephemeral by design.
Don't create more than one per hour (the rate limit above).
