# Board invites

## Sub-features

- `board-invites` Board invites.
- `invite-accept` `/invite` (`src/app/invite/page.tsx`) needs `?key=<invite key>`. No key sends a signed-out visitor to `/login`. A key with no invite row sends a signed-out visitor to `/login` with `project`, `key`, `projectId` and `view` kept, so signing in can still join. A signed-in join that returns 200 opens `/project?id=<projectId>`, and keeps `view` when the link has one. A guest demo cookie is not a member: the page does not redeem it, and the visitor stays on the invite sign-in screen instead of `/` and the guest demo. The page stores `inviteKey`, and `project` plus `projectInvite` when those values are present, for 10080 seconds (`src/app/invite/InviteComp.tsx:16-29`).

## How to get to it (user POV)

Open `/invite?key=<invite key>` from an invite link. Creating the link is Settings > Team > Members > Invite, and the invite command dialog (`src/components/Modals/commands/inviteMember.tsx`). A pending invite shows Resend and Cancel; they call `POST /api/invite/reSendInvite` and `POST /api/invite/cancelInvite` with `{ projectId, email }` (`src/hooks/MultiPages/useInviteCallbackHandlers.ts`). New invites go through `POST /api/invite/createInviteLink` with `{ projectId, emails: [<address>] }`, which answers 200 with the array of invited addresses, not the key, and lists the address in `emailsInvited` on `GET /api/members/getAll?projectId=<id>` (`src/pages/api/invite/createInviteLink.ts:30-53`). The key itself is shown only by the owner's Invite dialog.

## Driving it with agent-browser

Use the shared fixture board 7283 (**QA Team Board**): owner 4036 (`~/.config/ht-qa/state-owner.json`), member 4037 (`state-member.json`). Any other QA account (for example 3413, `state-pro.json`) is an outsider.

1. As owner 4036, invite a throwaway QA address you control (for example `valentin+qa-invite@hypertask.ai`) from the invite dialog; it shows as pending.
2. As owner 4036, click Resend on that pending invite: `reSendInvite` answers 200 and the pending row stays.
3. As the outsider, `POST /api/invite/reSendInvite` and `POST /api/invite/cancelInvite` with `{ projectId: 7283, email: <that address> }`: both answer 403, and the owner still sees the pending invite after reload (HTPR-7176).
4. Without any login both routes answer 401.
5. Sign this browser out (`POST /api/auth/force-signout` clears `nookies_user` and the session cookie), then open `/invite` with no `key` and confirm the landing is `/login`, not `/demo`. A dead `?key=` is the same check on its own and lands on `/login?key=<that key>`; expects run once at the end, so one journey takes one link. Open `/invite?key=<that invite key>` signed out and confirm the page stays on sign-in (it does not continue into the guest demo). A signed-in QA account that is not on board 7283 and redeems a live key gets a 200 join and lands on `/project?id=<projectId>`. The redemption itself is `verified-unreachable: needs the key the owner's Invite dialog displays plus a fresh non-member mailbox; tried /invite with no key, /invite with a dead key, and createInviteLink, which returns only the invited address`.

### Hands-free drive on production

```bash
node .claude/skills/verify-hypertask/scripts/feature-map-drive.mjs board-invites --dir /tmp/feature-map-drive
```

Prints `PASS` or `FAIL` per step, writes `result.json` and screenshots into `--dir`, and ends with
`board-invites ok`. It refuses any base except `https://app.hypertask.ai`, uses the `qa-login` identities,
creates only fixtures its own cleanup removes, and never prints a cookie, token or email address.

## Gotchas

- Routes trusting an id from the request body (`userId`) instead of the login, or skipping the owner/member check on the board (HTPR-7176 for resend).
- Resend on an address with no pending invite answers 500 (no invite to resend); not a regression.
- A signed-in join that does not return 200 leaves the login screen up. This page does not show its own error.
- The `board-invites` step in `.claude/skills/verify-hypertask/scripts/feature-map-drive.mjs` still asserts the old landing (`/` then `/demo`) and needs the `/login` landing next; every feature page names that script, so editing it inside a fix drags six unrelated areas into the pull request verifier.
- A head-verifier journey may land on `/login`: `src/app/login/page.tsx` mounts `src/components/analytics/StoreUTM.tsx` for UTM attribution only. It no longer asks `api.ipify.org` or `api.ipapi.com` for the visitor's IP, so a signed-out journey to `/login` keeps its requests on the app origin (HTPR-9534). Any new third-party call on a page a journey visits fails the verifier's `offOrigin` check; only `cdn.usefathom.com` is quiet in `noteForeign`.

### What proof to collect

Checklist written before QA; statuses for steps 2 to 4 (ids only, no emails or cookies in the proof); a screenshot of the pending invite before and after the outsider's attempt. Record account ids, never credentials.

### Automated evidence

`node --test tests/invite-email.test.cjs` exercises invite creation and resend with mocked email delivery, including refusal of an outsider and use of the session identity instead of the body userId; cancel-route authorization is not covered.

### Cleanup

As owner 4036, Cancel the throwaway invite and confirm it is gone after reload.
