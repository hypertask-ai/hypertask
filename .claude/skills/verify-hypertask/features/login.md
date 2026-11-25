# Login

## Sub-features

- `login` Login.
- `oauth-consent` Open `/oauth/consent` while signed in, with a valid consent token. The heading names the app and says it wants to connect to your Hypertask account. Approve and connect posts the form to `/oauth/authorize`. Cancel returns home. A bad or expired token shows Connection request expired. An app that is no longer registered shows Connection request could not be completed. When `htpr-7552-agent-code-signin` is on and a browser device pairing is waiting, the page also shows Approve a new agent board only.
- `oauth-login` `src/app/oauth/login/page.tsx` copies every query parameter onto `/login`, replaces the address with that login URL, and shows Redirecting. `src/proxy.ts` lets every `/oauth*` path through, so a signed-out visit does render the page; the Redirecting flash is too short to assert on, but the landing address keeps the query (`/login?returnTo=%2Finbox`).
- `oauth-success` Open `/oauth/success`. The heading is You're almost there. A valid `redirect_uri` says the MCP client will be able to access this account. When a `code` is present, Authorize and return to client posts that code to `POST /api/oauth/authorization-code/agent` and then opens the redirect. With no code, Return to client opens the redirect. Cancel returns home. A missing or invalid redirect says to return to the MCP client or stay in Hypertask, and the button is Cancel.
- `qa-login` Open `/qa/login`. When QA login is configured and the QA user is an owner or a QA user, the page shows QA test login and a form for email and password. Submit calls `POST /api/auth/qa-login`. Success opens the returned redirect URL, or the app home when that field is absent. A 404 from that route shows This sign-in is not available. Any other failure shows Invalid email or password, or the server error text. When QA login is not configured, or the QA user is not allowed, the page is not found.
- `unauthorized` Open `/unauthorized`. The heading is This board or ticket is unavailable. The copy says it may have been deleted or archived, or you may not have access, and to ask a board member for an invite. The button label is Return to previous board. Pressing it opens the first board from `GET /api/projects/getFirst`. When that response has no board, or the lookup returns 400 or 401, the page signs the person out. Any other lookup failure leaves the page in place. When project entry is on and the signed-in person has an email, the page also shows Signed in as that email and Switch account.
- `verify-email` Open `/verify-email`. A `token` query is posted to `POST /api/auth/verify-email-token` and the page shows Verifying your email. Success shows Email Verified. A person who is already signed in is then sent into the app. Failure shows Verification Failed and Go to Login. With no token the page shows Verify Your Email, To Activate Your Free Trial, Open Gmail, Open Outlook, and resend verification email. Resend calls `POST /api/auth/send-email-link` with a JSON body `{email}`; the `email` query only pre-fills the field. A success alert says Verification email sent.
- `agent-signin` With `htpr-9277-boat-dev-model` on for the requester, `/login` renders the split layout from `src/app/login/LoginComponent.tsx` and `src/app/login/LoginMiddle.tsx`: wordmark and copy on the left of a wide screen, one card on the right with Continue with Google, the email field, Continue with email and Sign in with a passkey. When `htpr-7552-agent-code-signin` is also on it adds a Sign in an agent link and the caption Connect your agent with a sign-in code. With either flag off, `/login` from `src/app/login/page.tsx` renders the existing markup unchanged. `/login/agent` from `src/app/login/agent/page.ts` is not found unless both flags are on; signed out it redirects to `/login?returnTo=%2Flogin%2Fagent`, a person lands on `/cli-auth?agent=1`, and an agent session, a `cli-bearer` session or device pairing off is not found. Google in `src/app/login/LoginButton.tsx` carries a safe `returnTo` through OAuth, so choosing Google from the agent route returns to `/login/agent`; an unsafe target is ignored. Signed in with `add_account=1`, `/login` shows this layout for the QA account instead of redirecting into the app.
- `email-straight-board` With `htpr-7553-email-straight-board` on for the requester, a new email with no invite and no return path skips the sign-in code. The flag's default mode is OWNER_AND_QA. `POST /api/auth/send-email-link` reads the signed-in user, or user 0 when signed out, and user 0 does not get the flag. A signed-in visit to `/login` is redirected into the app unless the `add_account` cookie is `1`; the **Add account** button on Settings > Accounts sets that cookie for 10 minutes and then opens `/login`. The route then creates the account and returns `straightBoardRedirect`. The browser opens that URL. Until the address is verified, a strip says Please confirm your email. The strip stays off the sign-in screen, the first-run screen, `/verify-email`, invite and share screens, and `/unauthorized`. An email that already has an account still receives the sign-in code. Do not change the flag audience.
- `free-mode-signup` With `htpr-7983-free-mode-signup` on for the current account, a guest on a wide board, inbox, calendar, or task list has the AI chat open on load. On a phone, the top bar shows Sign up. That button opens a dialog titled Log in or sign up. After an email code succeeds, a board redirect gains `welcome_ai=1`. The flag's default mode is OWNER_AND_QA. Both controls call `useFlag` for the guest, whose id is not user 6 or QA 985, so a real guest does not see this UI. Runners do not change the audience. Live QA records the guest chat and the Sign up button as UNREACHABLE. Closest proof is `tests/htpr-7983-guest-signup.test.cjs` and `src/lib/flags/definitions/htpr-7983-free-mode-signup.ts`.

## How to get to it (user POV)

`https://app.hypertask.ai/login`, or any deep link that redirects there when
signed out (`src/proxy.ts` gates routes). Google OAuth via Firebase, or
an email magic link (15-minute expiry, audience `email-link`).

`/oauth/login` copies its query onto `/login`. On a signed-out visit the proxy lets the `/oauth*` path through, the page copies the parameters, and the browser lands on `/login?returnTo=%2Finbox`. `/oauth/consent` is the approval screen after an app asks to connect; without a live consent token it shows Connection request expired. `/oauth/success` is the screen after that approval, before the browser returns to the MCP client. `/qa/login` is the QA test login and is configured on production. `/unauthorized` needs a session; signed out it redirects to `/login`. `/verify-email` is the link in the verification email. With `htpr-7553-email-straight-board` on for the signed-in QA account, a brand-new email submitted from Add account lands on its board and sees Please confirm your email. The guest chat and phone Sign up for `htpr-7983-free-mode-signup` are UNREACHABLE while that flag stays OWNER_AND_QA.

## Driving it with agent-browser

`agent-browser`, headless, against production, signed in with a saved
storage state passed as `--state` (the plan files are in `README.md`'s
"Plan accounts" section; flag checks use the two files named in
`verify-hypertask/SKILL.md`). Don't drive the OAuth consent screen or mint your own
JWT; use the saved session cookies like every other verification does.
Confirm the `nookies_user` cookie lands and the app boots into a board, not a
blank shell.

1. Signed out, open `/oauth/login?returnTo=%2Finbox`. The address becomes `/login?returnTo=%2Finbox` and the sign-in page renders. Redirecting is on screen for well under a second; do not assert on it. Do not treat the kept `returnTo` as a regression.
2. Do not start a live OAuth grant. Open `/oauth/consent` with no token and confirm Connection request expired plus Return to Hypertask. On `/oauth/success?redirect_uri=https%3A%2F%2Fexample.com%2Fcb` confirm You're almost there, the copy Your MCP client will now be able to access this account, Return to client and Cancel; do not press Return to client.
3. Open `/qa/login`. On production it renders the QA test login form (Email address, Password, Sign in). Do not submit a password. If the page is not found, record that QA login is not configured.
4. Signed out, `/unauthorized` redirects to `/login`, so open it as QA 985. Confirm the heading This board or ticket is unavailable, the copy, Signed in as <email>, Switch account, and the button Return to previous board. Press it only when this account already has a board; it opens the first board from `GET /api/projects/getFirst`, which for 985 is `https://app.hypertask.ai/project?id=15`.
5. Signed out, open `/verify-email`. Confirm Verify Your Email, To Activate Your Free Trial, Open Gmail and Open Outlook, and that resend stays disabled until an email is present. With a one-off invalid token (`/verify-email?token=disposable-invalid-token`) confirm Verification Failed, Invalid or expired token and Go to Login. Do not resend to a real inbox.
6. Signed in as QA 985, `/login` redirects into the app (`/project?id=15`). The `add_account` cookie, not a query parameter, is what keeps `/login` on screen: click **Add account** on `/settings/accounts` and confirm the browser opens `/login` with cookie `add_account=1` and the email field. Stop there. Do not submit a new address: it creates a real production user and board that cannot be removed from the product. Record the straight-board redirect and the Please confirm your email strip as verified-unreachable: the prerequisite is a disposable production account plus board, and the route attempted was `/settings/accounts` > Add account > `/login` > email field.
7. Record the guest AI chat and the phone Sign up button as UNREACHABLE. `htpr-7983-free-mode-signup` is OWNER_AND_QA, and `useFlag` reads the guest account, which is neither user 6 nor QA 985. Do not change the flag audience. Closest proof is `tests/htpr-7983-guest-signup.test.cjs` and `src/lib/flags/definitions/htpr-7983-free-mode-signup.ts`.

## Gotchas

- Better Auth version drift taking sign-in down ([HTPR-6395](https://app.hypertask.ai/detail/project-15/6395), pinned to 1.6
  after a 1.7 table check broke it).
- QA login attempts leaking email into logs ([HTPR-6536](https://app.hypertask.ai/detail/project-15/6536), fixed to keep
  email out of QA login logs).
- Hydration mismatches on first load right after auth
  ([HTPR-6609](https://app.hypertask.ai/detail/project-15/6609)) show up as a flash of wrong content or a stuck
  spinner right after redirect.
- `/oauth/consent` without a valid consent token is the expired screen, not a crash.
- `/qa/login` not found means the QA login switch is off. Do not treat it as a bad password.
- Straight-board signup creates a real user before the email is confirmed. Use a disposable address. Do not invite other people from that account.
- Sign up for `htpr-7983-free-mode-signup` is on the phone when that flag is on for the guest. At OWNER_AND_QA a real guest sees neither the button nor the open chat. Do not change the audience to force them.

### What proof to collect

Screenshot the signed-in landing state (a real board, not `/login`). Check
the URL bar in the screenshot metadata or via `agent-browser get url`, since
a silent bounce back to `/login` looks like a normal page from a thumbnail
alone.

Also screenshot the signed-out `/oauth/login?returnTo=%2Finbox` landing on `/login?returnTo=%2Finbox`, the `/oauth/consent` expired screen, the `/unauthorized` heading signed in, `/verify-email` with no token and with an invalid token, and the login page after **Add account** set its cookie. Record the Redirecting flash, the straight-board redirect, the guest chat, and the phone Sign up button as UNREACHABLE. Do not save passwords, tokens, or consent secrets.

### Cleanup

None. Login itself writes no board data.

A straight-board check creates a user and a board. Leave production accounts in place. Record the disposable address and do not delete a real person. Sign out of any QA login that replaced the saved QA cookies, and restore that storage state. Close the guest sign-in dialog without finishing signup.
