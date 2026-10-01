---
name: verify-qa
description: After the production deploy, the session that built the change verifies it on app.hypertask.ai and fixes anything that fails
---

# verify-qa

Load this at the `/ship` step **after deploy**. The session that built the change verifies it on production. A merged pull request is not proof. If a case fails, you fix it and ship again, then run this skill again.

Proof bar follows Lauren Tan's verification skills: [create-verification-skill](https://github.com/cursor/plugins/tree/main/pstack/skills/create-verification-skill), [maintain-verification-skill](https://github.com/cursor/plugins/tree/main/pstack/skills/maintain-verification-skill), and [poteto/verification-skill-example](https://github.com/poteto/verification-skill-example). Doctor first. Drive the real app. Prove side effects. Mocks never count.

## Logins

Pass the state file with `--state`. Never print the file.

- `~/.config/hypertask-videos/storageState-qa.json` is valentin@hypertask.ai (user 985). It sees every Owner + QA flag. Use it for the flagged path and for the doctor shot.
- `~/.config/hypertask-videos/storageState-qa-normal.json` (user 2343) is a plain account. Use it for the flag-off path.
- Never use Valentin's account, password, or cookies. If the shot is a login page, the state expired: say so and stop. Do not invent a login.

## Steps

0. **Pick the feature-map page** for the area the ticket touches, from `reference/feature-map/INDEX.md`. Read only that page. It says how a customer reaches the area, how to drive it, what usually breaks, what proof to collect, and the cleanup. If the area has no page, or this change altered the UI, add or update the page in the same pull request before you call the run done (maintain-verification-skill: the map stays honest with the app).
1. **Doctor first.** Do not judge the change until both are true:
   - The GitHub Production deployment for the merge sha is `success`.
   - The QA login is signed in on `https://app.hypertask.ai/my-tasks`. Shoot that page with `phone-shot.sh` and `--state ~/.config/hypertask-videos/storageState-qa.json`. A login page is a failed doctor, not a failed feature.
2. **Read the ticket's acceptance criteria** and note the pull request and the merge sha.
3. **Exercise every entry point the feature-map page lists.** On these pages that means every route and action under "How a customer reaches it" and "How to drive it", plus every success, cancel, error, empty, and persistence-after-reload path this change can affect. Drive `https://app.hypertask.ai` with `agent-browser` or `phone-shot.sh`. Prove side effects: the data is saved, and a reload keeps it. A screenshot of pixels alone is not proof. Mocks, a unit test, and a preview do not count.
4. **Name each unreachable path** with the concrete reason (auth, plan, flag, missing data) and cover the closest real path you can reach. Record that path as `UNREACHABLE`, not as a skip you forget.
5. **For any ticket touching UI**, take a real 390x844 screenshot on production:
   ```
   .claude/skills/verify-on-phone/scripts/phone-shot.sh https://app.hypertask.ai/<path> ~/.local/state/vcc-evidence/HTPR-NNNN/<name>.png --state ~/.config/hypertask-videos/storageState-qa.json
   ```
   For the flag-off path, pass `storageState-qa-normal.json` instead. Desktop shots are 1440x900. When the UI changed, shoot light and dark. An HTTP 200, an unchanged URL, or a fixed sleep is not a pass.
6. **For a new flagged feature, check the flag mode** at `https://app.hypertask.ai/admin/flags` (or `GET /api/admin/flags`, `listFeatureFlagModes` in `src/lib/flags.ts`) before judging the change. FAIL a flagged feature if a logged-in normal account (user 2343) sees it with the flag off, or if the mode is anything other than `OWNER_AND_QA` without Valentin having widened it himself. `OWNER_ONLY` is a FAIL: the QA login cannot see the feature, so nothing was verified. Say so and ask for `OWNER_AND_QA`. `EVERYONE` is never a pass for a flagged feature; name the flag key and its mode. Real bug fixes that restore behaviour that used to work ship to everyone with no flag (Valentin, 2026-09-22). A `[BUGFIX]` title is not proof: if the diff adds new visible behaviour and has no flag, FAIL it.
7. **Write the evidence** in `~/.local/state/vcc-evidence/HTPR-NNNN/proof.md`. Screenshots (`*.png`) live in that same folder. The file contains:
   - a line starting `Feature map: .claude/skills/verify-qa/reference/feature-map/<file>.md`
   - a line starting `Doctor:` with the deploy sha and the result (deployment state, and whether `https://app.hypertask.ai/my-tasks` was signed in)
   - a `## Cases` section with one bullet per case, in this shape: `- PASS|FAIL|UNREACHABLE: <case> -> <evidence file name or reason>`

   Example:

   ```
   Feature map: .claude/skills/verify-qa/reference/feature-map/my-tasks.md
   Doctor: sha abc123 deployment success; https://app.hypertask.ai/my-tasks signed in as user 985

   ## Cases
   - PASS: open My Tasks shows the signed-in list -> my-tasks.png
   - PASS: reload keeps the same list -> my-tasks-reload.png
   - UNREACHABLE: flag-off empty board -> user 2343 has no board in this project; covered the empty filter on the same list -> empty-filter.png
   ```

   A PASS verdict requires no `FAIL` bullets. `UNREACHABLE` is allowed when the reason and the closest real path are both in that bullet.
8. **Report on the ticket with `vcc`, then move it with `vcc`.** One comment. Never assign anyone. Never assign userId 6 (Valentin) for any reason, including escalation. Only Valentin assigns himself. If he assigned himself or moved the ticket by hand, leave assignees and column as he left them.
   - **PASS** (no FAIL bullets): attach `proof.md` and the key screenshots, say what changed in plain language, then move to Done.
     ```
     vcc comment add HTPR-NNNN --attach ~/.local/state/vcc-evidence/HTPR-NNNN/proof.md --attach ~/.local/state/vcc-evidence/HTPR-NNNN/<shot>.png --text "<p><strong>PASS: verified on production.</strong></p><p>What you checked, in plain language, and what the user will notice.</p>"
     vcc task move HTPR-NNNN --section "Done"
     ```
   - **FAIL:** name the failing case, attach the evidence, move back to In Progress, fix, and ship again. Then run this skill from step 1.
     ```
     vcc comment add HTPR-NNNN --attach ~/.local/state/vcc-evidence/HTPR-NNNN/proof.md --text "<p><strong>FAIL: <exact case>.</strong></p><p>What you expected, what you saw, and where.</p>"
     vcc task move HTPR-NNNN --section "In Progress"
     ```
   Read the ticket back with `hypertask tasks get HTPR-NNNN` and confirm the column and the comment author.
9. **If the same failure is still there after two repairs,** stop looping. Post one comment that says what you tried, and ask Valentin one question if you are blocked. Do not invent a pass.
10. **If Valentin @mentioned you, reply with an @mention back**, using `<span data-type="mention" class="mention" data-id="Valentin Yeo" data-label="name-6">Valentin Yeo</span>`.
11. **Say which skill you used** in the comment (`verify-qa`).
12. **A correction goes into this file**, not into chat memory. When a check is corrected, edit this SKILL.md and say on the ticket which file changed.

## Notes

- Never print cookies, tokens, or the auth-state file into a comment, a log, or the terminal. Reference the path only.
- Compare against a baseline when a blank page might be the correct empty state.
- Archive or delete only fixtures you created, through the product UI, never SQL. On the private board named by the board-title constant in `e2e/smoke/lib/boardSetup.ts`, remove tasks that use that file's `QA_TASK_PREFIX` when you created them.
- A deployment wait or a stale login is not a product FAIL. Record it and stop until doctor passes.
- The nightly suite in `reference/e2b-fleet.md` is extra context. It does not replace this proof.
- When a live check needs a privilege this login is denied, verify everything you can reach, record the rest as `UNREACHABLE` with the exact refusal, and do not block the ticket to ask for a new credential (2026-09-15, https://app.hypertask.ai/detail/project-15/6472).
