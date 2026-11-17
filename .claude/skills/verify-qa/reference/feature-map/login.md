# Login

## Sub-features

- `login` Login.
- `oauth-consent` Open `/oauth/consent` while signed in, with a valid consent token. The heading names the app and says it wants to connect to your Hypertask account. Approve and connect posts the form to `/oauth/authorize`. Cancel returns home. A bad or expired token shows Connection request expired. An app that is no longer registered shows Connection request could not be completed. When `htpr-7552-agent-code-signin` is on and a browser device pairing is waiting, the page also shows Approve a new agent board only.
- `oauth-login` Open `/oauth/login`. The page copies every query parameter onto `/login`, replaces the address with that login URL, and shows Redirecting.
- `oauth-success` Open `/oauth/success`. The heading is You're almost there. A valid `redirect_uri` says the MCP client will be able to access this account. When a `code` is present, Authorize and return to client posts that code to `POST /api/oauth/authorization-code/agent` and then opens the redirect. With no code, Return to client opens the redirect. Cancel returns home. A missing or invalid redirect says to return to the MCP client or stay in Hypertask, and the button is Cancel.
- `qa-login` Open `/qa/login`. When QA login is configured and the QA user is an owner or a QA user, the page shows QA test login and a form for email and password. Submit calls `POST /api/auth/qa-login`. Success opens the returned redirect URL, or the app home when that field is absent. A 404 from that route shows This sign-in is not available. Any other failure shows Invalid email or password, or the server error text. When QA login is not configured, or the QA user is not allowed, the page is not found.
- `unauthorized` Open `/unauthorized`. The heading is This board or ticket is unavailable. The copy says it may have been deleted or archived, or you may not have access, and to ask a board member for an invite. The button label is Return to previous board. Pressing it opens the first board from `GET /api/projects/getFirst`. When that response has no board, or the lookup returns 400 or 401, the page signs the person out. Any other lookup failure leaves the page in place. When project entry is on and the signed-in person has an email, the page also shows Signed in as that email and Switch account.
- `verify-email` Open `/verify-email`. A `token` query is posted to `POST /api/auth/verify-email-token` and the page shows Verifying your email. Success shows Email Verified. A person who is already signed in is then sent into the app. Failure shows Verification Failed and Go to Login. With no token the page shows Verify Your Email, To Activate Your Free Trial, Open Gmail, Open Outlook, and resend verification email. Resend calls `POST /api/auth/send-email-link` with the `email` query. A success alert says Verification email sent.
- `email-straight-board` With `htpr-7553-email-straight-board` on for the requester, a new email with no invite and no return path skips the sign-in code. `POST /api/auth/send-email-link` creates the account and returns `straightBoardRedirect`. The browser opens that URL. Until the address is verified, a strip says Please confirm your email. The strip stays off the sign-in screen, the first-run screen, `/verify-email`, invite and share screens, and `/unauthorized`. An email that already has an account still receives the sign-in code.
- `free-mode-signup` With `htpr-7983-free-mode-signup` on, a guest on a wide board, inbox, calendar, or task list has the AI chat open on load. On a phone, the top bar shows Sign up. That button opens a dialog titled Log in or sign up. After an email code succeeds, a board redirect gains `welcome_ai=1`.

## How to get to it (user POV)

`https://app.hypertask.ai/login`, or any deep link that redirects there when
signed out (`src/proxy.ts` gates routes). Google OAuth via Firebase, or
an email magic link (15-minute expiry, audience `email-link`).

`/oauth/login` is the handoff into that same login screen. `/oauth/consent` is the approval screen after an app asks to connect. `/oauth/success` is the screen after that approval, before the browser returns to the MCP client. `/qa/login` is the QA test login. `/unauthorized` is the screen for a board or ticket you cannot open. `/verify-email` is the link in the verification email. With `htpr-7553-email-straight-board` on, a brand-new email lands on its board and sees Please confirm your email. With `htpr-7983-free-mode-signup` on, a guest on a wide board, inbox, calendar, or task list sees the AI chat open, and a phone shows Sign up.

## Driving it with agent-browser

`agent-browser`, headless, against production, signed in with a saved
storage state passed as `--state` (the plan files are in `INDEX.md`'s
"Plan accounts" section; flag checks use the two files named in
`verify-qa/SKILL.md`). Don't drive the OAuth consent screen or mint your own
JWT; use the saved session cookies like every other verification does.
Confirm the `nookies_user` cookie lands and the app boots into a board, not a
blank shell.

1. Open `/oauth/login?returnTo=%2Finbox` while signed out. Confirm the spinner says Redirecting and the address becomes `/login` with the same query parameter.
2. Do not start a live OAuth grant. If a consent URL from a local client is already in hand, open `/oauth/consent` and confirm the app name, Approve and connect, and Cancel. Press Cancel. On `/oauth/success` without a code, confirm You're almost there and do not press Authorize and return to client.
3. Open `/qa/login`. If the page is not found, record that QA login is not configured. If the form is present, do not submit a password in a log. Submit only with the configured QA account, then restore the saved storage state.
4. Open a board or ticket the QA account cannot see, or open `/unauthorized` directly. Confirm the heading This board or ticket is unavailable. Confirm the button label Return to previous board. Press that button only when this account already has a board. Confirm the address is that first board. Do not expect the board that was open before this page. If an email is shown, confirm Switch account is present and do not switch.
5. Open `/verify-email` with no token. Confirm Verify Your Email and that resend stays disabled until an email is present. Do not resend to a real inbox. With a disposable token, confirm Verifying your email and then either Email Verified or Verification Failed.
6. With `htpr-7553-email-straight-board` on, submit a new disposable email at `/login` with no invite and no return path. Confirm the browser leaves login for the redirect in `straightBoardRedirect`, and that Please confirm your email is visible. Repeat with an email that already has an account and confirm the sign-in code step still appears.
7. With `htpr-7983-free-mode-signup` on, open a guest board, inbox, calendar, or task list on a wide window and confirm the AI chat is open. Narrow to a phone width and confirm the top bar shows Sign up. Open it and confirm the dialog title Log in or sign up. Close the dialog. Do not finish a real signup.

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
- Sign up for `htpr-7983-free-mode-signup` is on the phone. The wide-screen proof is the open AI chat. Do not expect the button on a wide window.

### What proof to collect

Screenshot the signed-in landing state (a real board, not `/login`). Check
the URL bar in the screenshot metadata or via `agent-browser get url`, since
a silent bounce back to `/login` looks like a normal page from a thumbnail
alone.

Also screenshot `/oauth/login` after the redirect, the `/unauthorized` heading, `/verify-email` with no token, the confirm strip after a disposable straight-board signup, the guest chat on a wide window, and the phone Sign up button. Do not save passwords, tokens, or consent secrets.

### Cleanup

None. Login itself writes no board data.

A straight-board check creates a user and a board. Leave production accounts in place. Record the disposable address and do not delete a real person. Sign out of any QA login that replaced the saved QA cookies, and restore that storage state. Close the guest sign-in dialog without finishing signup.
