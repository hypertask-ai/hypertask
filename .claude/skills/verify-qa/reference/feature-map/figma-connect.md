# Figma connect

## How a customer reaches it

Settings > Accounts (`/settings/accounts`, `src/components/Modals/Settings/AccountsSection.tsx`) shows a **Connected apps** card with a **Figma account** row. The row's button reads **Connect Figma** until the user links an account, then shows the Figma name with **Disconnect**. The button starts OAuth at `/api/figma/oauth/start`; Figma returns to `/api/figma/oauth/callback`, which saves the user's Figma link and bounces back to Settings > Accounts. Linked Figma frames in tickets render through `/api/figma/oembed`, using the user's link when connected. Always on since HTPR-6136; flag removed in HTPR-7402.

## How to drive it

1. As plain customer 2343, open `/settings/accounts` at 1440x900 and 390x844. Expect **Connected apps** above **Passkeys**, with the **Figma account** row and a **Connect Figma** button.
2. In the page, `fetch("/api/figma/connection")`. Expect 200 with `configured: true` and `connection: null` for an unlinked user; signed out it is 401.
3. Click **Connect Figma**. Expect a redirect to `https://www.figma.com/oauth` with the app's client id; stop there, do not authorize a real Figma account.

## What usually breaks

- The **Connected apps** card disappears, or the Figma routes answer 404 for a signed-in user.
- **Connect Figma** bounces straight back with `figma_error=not_configured` (the server lost its Figma keys).

## What proof to collect

Checklist written before QA; screenshots of Settings > Accounts on desktop and phone; the `/api/figma/connection` status; the OAuth redirect host. Record account ids only.

## Cleanup

None: the run never links a Figma account.
