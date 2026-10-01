---
name: verify-on-phone
description: Any ticket touching UI, before opening the PR
---

# verify-on-phone

A pre-PR gate for any ticket whose change is visible on screen. Run it before `open-pr.sh`, not after.

**Two shots, not one, because a production screenshot of an unmerged fix does not exist yet:**

1. **Before the PR (pre-PR), from your own worktree's local dev server.** `npm run dev` in the repo (`hypertask-oss/package.json`) starts `next dev` on `http://localhost:3000`, so the fix on your branch is reachable before you open the PR. Shoot that local URL with your own changes checked out. This proves the fix renders; it does not prove production behavior.
2. **After the deploy, on production, by this same session.** `verify-qa` is the pass condition. The pre-PR local shot is evidence you looked before opening the pull request. It does not replace the production check.

## Steps

1. **Take the pre-PR shot from the local dev server:**
   ```
   npm run dev   # in your worktree, backgrounded; wait for it to report ready on :3000
   .claude/skills/verify-on-phone/scripts/phone-shot.sh http://localhost:3000/<path> <out.png>
   ```
   `phone-shot.sh` takes any URL, local or production. It drives `agent-browser` at 390x844 with a mobile Safari user agent. Local dev serves the app unauthenticated in most flows. When the page needs a signed-in session, pass `--state`. The default, when you omit `--state`, is `~/.config/hypertask-videos/storageState-qa.json` (user 985, sees Owner + QA flags). For the flag-off path pass `--state ~/.config/hypertask-videos/storageState-qa-normal.json` (user 2343). Never point `--state` at Valentin's account.
   **No local dev server available for this change** (a server-only fix with nothing that runs standalone, or `npm run dev` fails to boot in the worktree)? Say so on the ticket, shoot the **production "before"** instead (the bug as it exists today), and note that the "after" is `verify-qa` on production after the deploy.
2. **Check it is the right page, logged in if the page needs it.** The script fails if it lands on a login screen and warns if it was redirected somewhere other than the URL you asked for. Neither check proves the page is correct, only that it is not obviously wrong, so read the warning if you get one.
3. **Inspect the screenshot for a meaningful ready or empty state**, not just "a page loaded". An HTTP 200, an unchanged URL, or a fixed sleep before the screenshot proves nothing on its own. If the correct state for this ticket might legitimately look blank or empty, shoot a baseline first and compare, so a genuinely broken blank page is not mistaken for the expected one.
4. **If the change is behind a feature flag**, the flag must be on for the account in the auth state, or you are photographing the old UI. Turn it on for that account before shooting, and say in the ticket comment which account and flag the shot used.
5. **Compare against the ticket's acceptance criteria line by line.** If anything does not match, fix it and reshoot. Do not open the PR hoping QA catches it.
   **Default states need a clean preference.** When acceptance criteria specify the initial state of a persisted control, remove that control's saved preference from your own browser before loading the page. A remembered choice does not prove the default.
   **Closed or idle surfaces count.** When the ticket asks for a control on a closed, collapsed, or idle bar, screenshot that closed state. A shot of the opened or focused state does not prove the ticket.
6. **Attach the screenshot to the ticket:**
   ```
   vcc comment add <ticket> --attach <out.png> --text "<p><strong>Pre-PR phone check at 390x844, local dev server.</strong> verify-qa checks production after the deploy.</p>"
   ```
   Attach the file; never embed it as a markdown image, which crashes the ticket UI.
7. **Never print the auth-state file's contents, any cookie, or any token** into a comment, a log, or the terminal. Reference the path only.

## Notes

- If the state file is missing or stale the script fails loud and points at `~/projects/hypertasks/AGENTS.md` and `openwiki/auth.md`. Do not invent a login flow to work around it.
- This is a pre-PR gate. `verify-qa` is the production check after the deploy, and you run that too. For a mobile or responsive ticket, reading code or checking a desktop-width window is never verification. Anything short of a real 390x844 screenshot on production with the flag on is not a pass (Valentin, 2026-09-11, after a mobile ticket passed on desktop width and was broken on his phone).
