---
name: verify-qa
description: A ticket in QA with label skills-pilot; verify the shipped change on production before it can be Done
---

# verify-qa

Independent QA for the skills pilot. You verify, you never fix. Only tickets carrying the `skills-pilot` label on project 15.

## Steps

1. **Read the ticket's acceptance criteria and the dev agent's hand-off comment.** Note the exact PR, the merged commit, and whether production has actually received it. Read the Gates block in that comment too: any gate marked unmet, or met with no evidence, is a FAIL naming that gate — don't independently re-derive what the dev already logged as unmet.
2. **Reproduce the acceptance criteria on production**, not on a desktop window or by reading code. A merged PR or a passing CI job is not proof it shipped; check the deployed revision and the real behavior at `https://app.hypertask.ai`.
3. **For any ticket touching UI**, take a real 390x844 phone-viewport screenshot on production:
   ```
   .claude/skills/verify-on-phone/scripts/phone-shot.sh https://app.hypertask.ai/<path> <out.png>
   ```
   Use your own runtime's `$HT_PRODUCTION_STORAGE_STATE_FILE`, never a dev agent's or Valentin's. If the feature is behind a flag, turn it on for the account in that state before shooting, and say which account and flag in the comment. Anything short of this real screenshot is CANNOT VERIFY, not PASS.
4. **Inspect the screenshot for a meaningful ready or empty state**, not just "a page loaded". An HTTP 200, an unchanged URL, or a fixed sleep proves nothing on its own. Compare against a baseline if a blank page might legitimately be expected.
5. **For a new flagged feature, check the flag's rollout state before judging the change.** Read the flag's mode at `https://app.hypertask.ai/admin/flags` (or `GET /api/admin/flags`, `listFeatureFlagModes` in `src/lib/flags.ts`). FAIL a flagged feature if the change is visible to a logged-in normal-user test account with the flag off, or if the flag's mode is anything other than `OWNER_AND_QA` without Valentin having explicitly widened it himself. `OWNER_ONLY` is also a FAIL, not a pass: QA cannot see the feature at that mode, so nothing was verified. Say so and ask for `OWNER_AND_QA`. `EVERYONE` is never a QA pass for a flagged feature; name the flag key and its current mode in the FAIL comment. Bug fixes never get a flag and ship to everyone; verify them directly on production.
6. **Compare against the acceptance criteria line by line.** For agent-authored ticket activity, write the activity as the agent and read the ticket as a separate authorized browser user; checking both sides with one identity misses ownership-filter bugs.
   - **PASS:** attach the evidence and move the ticket to Done.
     ```
     hypertask comment add <ticket> --attach <out.png> --text "<p><strong>PASS: verified on production.</strong></p><p>What was checked and what the screenshot shows, in plain language.</p>"
     hypertask task move <ticket> --section "Done"
     ```
   - **FAIL:** name the exact failing step and move the ticket back to In Progress.
     ```
     hypertask comment add <ticket> --text "<p><strong>FAIL: <exact failing step>.</strong></p><p>What you expected, what you saw, and where.</p>"
     hypertask task move <ticket> --section "In Progress"
     ```
7. **Never assign anyone on the verdict.** Leave existing assignees as they are. Never assign userId 6 (Valentin) for any reason, including escalation — only Valentin assigns himself.
8. **If Valentin @mentioned you in a comment, reply with an @mention back**, using the exact mention markup the editor writes: `<span data-type="mention" class="mention" data-id="Valentin Yeo" data-label="name-6">Valentin Yeo</span>`.
9. **Post which skill you used in your first comment on the ticket.**
10. **A correction goes into this file, never into chat memory.** When QA is corrected, edit this SKILL.md and say on the ticket which file changed.

## Notes

- Never print cookies, tokens, or the auth-state file's contents into a comment, a log, or the terminal. Reference the path only.
- Never load or use another agent's credential for verification. Your own runtime provisions your own storage state.
- Two failed repairs of the same issue exhaust the automatic retry budget; a third genuine FAIL is a signal to say so on the ticket, not to keep bouncing the same verdict.
- Archive only test fixtures you created yourself, through the product UI, never SQL.
- Run an E2B flow when the ticket touches a covered screen: `reference/e2b-fleet.md`.

## Auto-added rules

- When a live verification step requires privileges the QA identity is deliberately denied, verify everything reachable, record the unverified step with the exact refusal text in a ticket comment, and pass the ticket on rather than blocking to request a credential grant. (auto, 2026-09-15, https://app.hypertask.ai/detail/project-15/6472)
