VERDICT: PASS

Re-review of PR #3814 (`boss-9621/auto-switch-account`) at `b1b48c8` vs `origin/production`. Scope: security only; line references are to files as merged on that branch.

## Original seven findings

| Area | Status | Reference | Reason |
|------|--------|-----------|--------|
| Account existence oracle | FIXED | `src/lib/auth/ticketAccountSwitch.ts:71-92`, `src/app/api/auth/ticket-account-switch/route.ts:121` | Device-session rows are checked in `betterAuthSession` before use; with no verified siblings the route returns `stay` before ticket resolution, so unverified `listDeviceSessions` rows cannot drive lookups. |
| Open redirect | FIXED | `src/lib/auth/ticketDetailLocator.ts:14-19`, `src/lib/auth/ticketDetailLocator.ts:28-32`, `src/app/api/auth/ticket-account-switch/route.ts:33-38` | Redirect targets are built only from `ticketDetailFields` / `ticketDetailLocator` (`project-\d+` + allowed ticket shapes); bad slugs yield `locator === null` and `/inbox`. |
| CSRF on the switch | FIXED | `src/lib/auth/session.ts:166-170`, `src/app/api/auth/ticket-account-switch/route.ts:92-97`, `src/lib/auth/ticketDetailLocator.ts:137-163` | Session cookies are `SameSite=Lax`, so cross-site POST forms do not send auth and the route exits at `!user`; the auto-POST runs only same-origin from the unauthorized ticket page, not from a third-party origin. No explicit `Origin` check (unlike some API routes), but browser cookie policy blocks practical CSRF. |
| Rate limit | FIXED | `src/lib/auth/ticketAccountSwitchRateLimit.ts:5-7`, `src/lib/auth/ticketAccountSwitchRateLimit.ts:82-105`, `src/app/api/auth/ticket-account-switch/route.ts:99-107` | Per-user and per-IP Redis windows are enforced; over-limit and missing client IP both return `stay`; production Redis errors throw and are caught in the route (fail-closed to `stay`). |
| Leaking ticket existence across accounts | FIXED | `src/app/api/auth/ticket-account-switch/route.ts:26-30`, `src/lib/auth/ticketAccountSwitch.ts:118-139`, `src/lib/auth/ticketAccountSwitch.ts:43-59` | Responses expose only `{ action: "stay" \| "choose" \| "switch" }`; missing vs inaccessible tickets share the same `stay` path when no sibling can open; access uses the same `taskWhere` / project access as the detail page. |
| Session failure handling | FIXED | `src/app/api/auth/ticket-account-switch/route.ts:109-150` | Failures in device listing, sibling verification, resolution, `setActiveSession`, or empty cookie sets all return `stay` (form posts redirect back to the ticket). |
| Flag gating | FIXED | `src/app/api/auth/ticket-account-switch/route.ts:96-97`, `src/lib/auth/ticketAccountSwitchProbe.tsx:40-41` | Server returns `stay` before device-session or ticket work when the flag is off; client probe skips `submitTicketAccountSwitch` unless the flag is true. |

## Supplemental checks

### Can a user learn anything about a ticket in a team they are not in?

**Mostly no** for the common case: with only the active account and no other verified device sessions, `route.ts:121` returns `stay` without running `resolveTicketAccountSwitch`, so no ticket DB reads occur and the body does not distinguish missing from forbidden (`tests/htpr-9621-auto-switch-account.test.cjs` covers the missing/hidden parity case).

**Residual, low:** If another account is already signed in on the same browser and verified as a sibling, the route may return `switch` or `choose` when that sibling can open the ticket—revealing that *some* on-device account can access it, not title/content and not to arbitrary third parties. A user with multiple accounts and no team access still cannot tell missing vs forbidden when no sibling can open (same `stay` + same lookup pattern in tests).

### Can an attacker make a victim switch accounts via a crafted link or cross-site form?

- **Cross-site form:** **No.** `SameSite=Lax` on session cookies prevents authenticated cross-site POSTs; unauthenticated requests get `stay` only.
- **Crafted Hypertask ticket URL:** **Yes, by design** when the victim navigates to `/detail/...` on Hypertask, sees the unauthorized page, and has another on-device account that can open the ticket—the client posts same-origin (`ticketDetailLocator.ts:152-163`). That is the intended product behavior, not third-party CSRF.

### Does flag off keep today's behavior exactly?

**Not exactly.** Server and switch paths match production (`route.ts:96-97`, modal guarded by `useFlag`). With the flag off, `StateRoot` still mounts `TicketAccountSwitchSlot` (`src/lib/state.tsx:323-328`) and `syncSwitchedAccountTabs` still runs on every page load without a flag guard (`ticketAccountSwitchProbe.tsx:28-33`), adding `ht-active-account` localStorage coordination and cross-tab listeners that do not exist on production today. Security intent (no auto-switch) is preserved; full behavioral parity when off is not.

## New issues

| Area | Status | Reference | Reason |
|------|--------|-----------|--------|
| Flag-off client surface | NEW ISSUE (non-security) | `src/lib/state.tsx:290-328`, `src/lib/auth/ticketAccountSwitchProbe.tsx:28-33` | Probe bundle loads globally and tab-sync runs even when the flag is off—behavior/parity gap, not an auth bypass. |
| CSRF defense style | NEW ISSUE (informational) | `src/app/api/auth/ticket-account-switch/route.ts:92` | No `trustedMutationOrigin`-style check; reliance on `SameSite=Lax` only—acceptable here but inconsistent with other sensitive POST routes. |

## Commits cited

- `ac505ff` — existence oracle, rate limit, sibling verification, response shaping
- `8f68af9` — rate-limit outage fail-closed
- `b1b48c8` — session/ticket lookup outage fail-closed

## Tests

`tests/htpr-9621-auto-switch-account.test.cjs` encodes the security cases above (forged sessions, redirect injection, parity of `stay`, rate-limit and outage paths, flag-off server behavior). Not re-run in this review-only branch.