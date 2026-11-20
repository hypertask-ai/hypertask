# Board invites

## Sub-features

- `board-invites` Board invites.
- `invite-accept` `/invite` (`src/app/invite/page.tsx`) needs `?key=<invite key>`. No key, or a key with no invite row, redirects to `/` (`src/app/invite/page.tsx:27-34`). A signed-in join that returns 200 opens `/project?id=<projectId>`, and keeps `view` when the link has one. A signed-out visitor who reaches `/` is then carried into the guest demo (`/` to `/demo` to `/project?id=<guest board>`), not to the login page, so read the invite redirect on the invite page itself, not on the final landing. The page stores `inviteKey`, and `project` plus `projectInvite` when those query values are present, for 10080 seconds (`src/app/invite/InviteComp.tsx:16-29`).

## How to get to it (user POV)

Open `/invite?key=<invite key>` from an invite link. Creating the link is Settings > Team > Members > Invite, and the invite command dialog (`src/components/Modals/commands/inviteMember.tsx`). A pending invite shows Resend and Cancel; they call `POST /api/invite/reSendInvite` and `POST /api/invite/cancelInvite` with `{ projectId, email }` (`src/hooks/MultiPages/useInviteCallbackHandlers.ts`). New invites go through `POST /api/invite/createInviteLink` with `{ projectId, emails: [<address>] }`, which answers 200 with the array of invited addresses, not the key, and lists the address in `emailsInvited` on `GET /api/members/getAll?projectId=<id>` (`src/pages/api/invite/createInviteLink.ts:30-53`). The key itself is shown only by the owner's Invite dialog.

## Driving it with agent-browser

Use the shared fixture board 7283 (**QA Team Board**): owner 4036 (`~/.config/ht-qa/state-owner.json`), member 4037 (`state-member.json`). Any other QA account (for example 3413, `state-pro.json`) is an outsider.

1. As owner 4036, invite a throwaway QA address you control (for example `valentin+qa-invite@hypertask.ai`) from the invite dialog; it shows as pending.
2. As owner 4036, click Resend on that pending invite: `reSendInvite` answers 200 and the pending row stays.
3. As the outsider, `POST /api/invite/reSendInvite` and `POST /api/invite/cancelInvite` with `{ projectId: 7283, email: <that address> }`: both answer 403, and the owner still sees the pending invite after reload (HTPR-7176).
4. Without any login both routes answer 401.
5. Open `/invite?key=<that invite key>` signed out. An auto-created guest demo session means the browser does not stay on the invite page: `/invite` redirects to `/` and `/` continues to the demo board, so read the `inviteKey` cookie and the first redirect hop rather than the final URL. A signed-in QA account that is not on board 7283 and redeems a live key gets a 200 join and lands on `/project?id=<projectId>`. Open `/invite` with no `key` and confirm the redirect chain starts `/invite` then `/`. The redemption itself is `verified-unreachable: needs the key the owner's Invite dialog displays plus a fresh non-member mailbox; tried /invite with no key, /invite with a dead key, and createInviteLink, which returns only the invited address`.

### Hands-free drive on production

```bash
node .claude/skills/verify-qa/scripts/feature-map-drive.mjs board-invites --dir /tmp/feature-map-drive
```

Prints `PASS` or `FAIL` per step, writes `result.json` and screenshots into `--dir`, and ends with
`board-invites ok`. It refuses any base except `https://app.hypertask.ai`, uses the `qa-login` identities,
creates only fixtures its own cleanup removes, and never prints a cookie, token or email address.

## Gotchas

- Routes trusting an id from the request body (`userId`) instead of the login, or skipping the owner/member check on the board (HTPR-7176 for resend).
- Resend on an address with no pending invite answers 500 (no invite to resend); not a regression.
- A signed-in join that does not return 200 leaves the login screen up. This page does not show its own error.

### What proof to collect

Checklist written before QA; statuses for steps 2 to 4 (ids only, no emails or cookies in the proof); a screenshot of the pending invite before and after the outsider's attempt. Record account ids, never credentials.

### Automated evidence

`node --test tests/invite-email.test.cjs` exercises invite creation and resend with mocked email delivery, including refusal of an outsider and use of the session identity instead of the body userId; cancel-route authorization is not covered.

### Cleanup

As owner 4036, Cancel the throwaway invite and confirm it is gone after reload.
