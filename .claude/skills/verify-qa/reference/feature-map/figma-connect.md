# Figma connect

## Sub-features

- `figma-connect` Figma connect.

## How to get to it (user POV)

Settings > Accounts (`/settings/accounts`, `src/components/Modals/Settings/AccountsSection.tsx`) shows a **Connected apps** card with a **Figma account** row. The row's button reads **Connect Figma** until the user links an account, then shows the Figma name with **Disconnect**. The button starts OAuth at `/api/figma/oauth/start`; Figma returns to `/api/figma/oauth/callback`, which saves the user's Figma link and bounces back to Settings > Accounts. Linked Figma frames in tickets render through `/api/figma/oembed`, using the user's link when connected. Always on since HTPR-6136; flag removed in HTPR-7402.

## Driving it with agent-browser

1. Sign in with the QA state, open `https://app.hypertask.ai/settings/accounts` at 1440x900. The **Connected apps** card is fetched after load: wait for the text `Connect Figma` (about 4s here), not just for the page. Expect the heading above **Passkeys**, the **Figma account** row, and one **Connect Figma** link whose `href` is `/api/figma/oauth/start?returnTo=%2Fsettings%2Faccounts`.
2. In the page, `fetch("/api/figma/connection")`. Expect 200 with `configured: true` and `connection: null` for an unlinked user; signed out it is 401.
3. Click **Connect Figma** and stop. The browser leaves for `www.figma.com`; when it has no Figma session it lands on `https://www.figma.com/login`, not `/oauth`, and no `client_id` is visible in the address. Do not authorize a real Figma account.
4. Repeat step 1 with the browser context created at 390x844 and an iPhone user agent. The same row and link render; give it the same ~4s.

With the CLI: `ht-verify api GET /api/figma/connection --state ~/.config/hypertask-videos/storageState-qa.json`
returns `{"configured":true,"connection":null}` for user 985.

## Gotchas

- The **Connected apps** card disappears, or the Figma routes answer 404 for a signed-in user.
- **Connect Figma** bounces straight back with `figma_error=not_configured` (the server lost its Figma keys).
- Read the card only after the connection fetch returns; while it is in flight the action reads **Loading**, not **Connect Figma**.
- An unconfigured server renders a disabled `<button>`, not a link, so an `<a href>` selector finds nothing.
- `/api/figma/oembed` answers 200 `{liveEmbed:true, canConnectFigma:true}` for a user with no Figma link, so a 200 there says nothing about the connection.

### What proof to collect

Checklist written before QA; screenshots of Settings > Accounts on desktop and phone; the `/api/figma/connection` status; the OAuth redirect host. Record account ids only.

### Automated evidence

`node --test tests/figma-accounts-settings.test.cjs` renders Accounts with mocked connection responses and checks configured OAuth links, the disabled unconfigured button, and the connected name with Disconnect.

### Cleanup

None: the run never links a Figma account.
