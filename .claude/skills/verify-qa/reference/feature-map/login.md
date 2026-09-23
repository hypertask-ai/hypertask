# Login

## How a customer reaches it

`https://app.hypertask.ai/login`, or any deep link that redirects there when
signed out (`src/middleware.ts` gates routes). Google OAuth via Firebase, or
an email magic link (15-minute expiry, audience `email-link`).

## How to drive it

`agent-browser`, headless, against production, signed in with one of the QA
runner accounts' saved storage state (`INDEX.md`'s "QA runner accounts"
section has the paths). Don't drive the OAuth consent screen or mint your own
JWT; use the saved session cookies like every other verification does.
Confirm the `nookies_user` cookie lands and the app boots into a board, not a
blank shell.

## What usually breaks

- Better Auth version drift taking sign-in down ([HTPR-6395](https://app.hypertask.ai/detail/project-15/6395), pinned to 1.6
  after a 1.7 table check broke it).
- QA login attempts leaking email into logs ([HTPR-6536](https://app.hypertask.ai/detail/project-15/6536), fixed to keep
  email out of QA login logs).
- Hydration mismatches on first load right after auth
  ([HTPR-6609](https://app.hypertask.ai/detail/project-15/6609), [HTPR-6199](https://app.hypertask.ai/detail/project-15/6199)) show up as a flash of wrong content or a stuck
  spinner right after redirect.

## What proof to collect

Screenshot the signed-in landing state (a real board, not `/login`). Check
the URL bar in the screenshot metadata or via `agent-browser get url`, since
a silent bounce back to `/login` looks like a normal page from a thumbnail
alone.

## Cleanup

None. Login itself writes no board data.
