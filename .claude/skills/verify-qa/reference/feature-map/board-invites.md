# Board invites

## How a customer reaches it

Settings > Team > Members > Invite, and the invite command dialog (`src/components/Modals/commands/inviteMember.tsx`). A pending invite shows Resend and Cancel; they call `POST /api/invite/reSendInvite` and `POST /api/invite/cancelInvite` with `{ projectId, email }` (`src/hooks/MultiPages/useInviteCallbackHandlers.ts`). New invites go through `POST /api/invite/createInviteLink`.

## How to drive it

Use the shared fixture board 7283 (**QA Team Board**): owner 4036 (`~/.config/ht-qa/state-owner.json`), member 4037 (`state-member.json`). Any other QA account (for example 3413, `state-pro.json`) is an outsider.

1. As owner 4036, invite a throwaway QA address you control (for example `valentin+qa-invite@hypertask.ai`) from the invite dialog; it shows as pending.
2. As owner 4036, click Resend on that pending invite: `reSendInvite` answers 200 and the pending row stays.
3. As the outsider, `POST /api/invite/reSendInvite` and `POST /api/invite/cancelInvite` with `{ projectId: 7283, email: <that address> }`: both answer 403, and the owner still sees the pending invite after reload (HTPR-7176).
4. Without any login both routes answer 401.

## What usually breaks

- Routes trusting an id from the request body (`userId`) instead of the login, or skipping the owner/member check on the board (HTPR-7176 for resend).
- Resend on an address with no pending invite answers 500 (no invite to resend); not a regression.

## What proof to collect

Checklist written before QA; statuses for steps 2 to 4 (ids only, no emails or cookies in the proof); a screenshot of the pending invite before and after the outsider's attempt. Record account ids, never credentials.

### Automated evidence

`node --test tests/invite-email.test.cjs` exercises invite creation and resend with mocked email delivery, including refusal of an outsider and use of the session identity instead of the body userId; cancel-route authorization is not covered.

## Cleanup

As owner 4036, Cancel the throwaway invite and confirm it is gone after reload.
