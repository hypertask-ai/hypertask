# Cookie consent

## How a customer reaches it

Any first visit without a `ht_cookie_consent` cookie: `/login`, `/signup`, a
board when signed in, or a guest board. The banner is
`src/components/Global/CookieConsentBanner.tsx`, mounted for everyone in
`GloablProviders.tsx`. The choice lives in `src/lib/cookieConsent.ts`.

## How to drive it

Headless Playwright with a fresh context for each case: no state for login
and signup, and the QA 985 state with any `ht_cookie_consent`, `ph_*` and
`posthog*` entries removed for a board. Wait about 12 seconds so PostHog's
deferred start has run, then read `context.cookies()`, `localStorage` and
`sessionStorage`. Click "Reject optional" or "Accept all", wait, reload and
read them again. Watch requests to `ipify`/`ipapi` and PostHog.

## What usually breaks

- PostHog writing `ph_posthog_hypertask` (cookie on `.hypertask.ai`,
  localStorage, sessionStorage) before a choice. Before a choice it must use
  memory persistence ([HTPR-7274](https://app.hypertask.ai/detail/project-15/7274)).
- The login page's `StoreUTM` calling ipify and writing `ip`, `userAgent` and
  `utm_*` cookies before a choice.
- The banner showing to guests only, or missing on login and signup.
- The cookie written for the app host only instead of `.hypertask.ai`, so
  hypertask.ai asks again.

## What proof to collect

For login, signup and a board: storage before the choice (no `ph_*`,
`posthog*`, `ip`, `userAgent` or `utm_*`), after Reject and reload (still
none, `ht_cookie_consent=essential` on `.hypertask.ai`, no banner), and after
Accept and reload (PostHog storage present, `ht_cookie_consent=all`). Add
banner screenshots at 1440x900 and 390x844 in all four themes, and the
cookie as seen by `https://hypertask.ai/`. Record ids only, never cookie
values other than the consent value.

## Cleanup

None. Fresh contexts are discarded. No board data is written.
