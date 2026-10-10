---
name: ship-feature-behind-flag
description: Ticket in Features asking for new UI or behaviour
---

# ship-feature-behind-flag

Use with `verify-on-phone` (before the PR), `simplify-before-pr` and `design-compliance` (right before the PR step). After the deploy, run `verify-qa` yourself. Board writes go through `vcc`. Write the pull request body into a file before `open-pr.sh`.

## Steps

1. **If the ticket touches UI, run `reuse-existing-ui` first.** Before writing a line of code, work through `reuse-existing-ui/SKILL.md`: list the UI elements the feature needs and reuse the existing component for each. A new feature that quietly rebuilds a component the app already has is not "new UI", it's duplicated UI.
2. **Decide whether this ticket needs a flag.** Every new feature, screen, control, shortcut, API route, or deliberate behaviour/design change needs one. Real bug fixes use a ticket-named `kind: "bugfix"` flag on for Everyone by default, except saved-data, security and crash fixes, which need no flag (Valentin, 2026-10-06); use `fix-bug` for those. Bugfix flags get the same 14-day cleanup. A `[BUGFIX]` title alone is not proof; the reviewer decides from the diff whether it restores intended behaviour. New visible behaviour dressed as a fix needs a flag. Performance work with identical output, security fixes, dependency or CI changes, spelling corrections, and tickets carrying the **AI CHAT 💬** label also do not need a flag. Swapping an existing AI model for its newer version from the same provider (same slots, same plan gating, automatic fallback to the previous version) is a dependency update and needs no flag. Do not disguise a new feature as a bug fix.
3. **Find the flag mechanism.** The repo gates new UI and behaviour with `useFlag("htpr-NNNN-slug-name")`. The registry has one client-safe file per flag in `src/lib/flags/definitions/<flag-key>.ts`: each file exports its key constant and a default definition. Existing imports from `src/lib/flags/keys.ts` and `src/lib/flags.ts` remain supported. Name yours `htpr-<ticket-number>-<short-slug>`, matching the existing filenames. Never reuse a flag for a different feature.
4. **Register the flag** by adding only `src/lib/flags/definitions/<flag-key>.ts`, with its exported key constant, default definition and `releaseRisk: { risk, reason }`. Do not edit shared registry files or test lists; never commit the generated index. Add flag-specific tests in their own test file. `DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA"` in `src/lib/flags.ts` remains the repo default: Valentin and the QA account see it, nobody else. Only Valentin widens a feature flag's release, at `/admin/flags`. Never release to Everyone yourself.
5. **Gate the change** on that flag with `useFlag(...)` at the point the new UI or behaviour renders or runs, **and gate the protected behaviour on the server too**. `useFlag` only hides client UI; it never replaces API authorization.
6. **Take the phone screenshot** with `verify-on-phone`, before the PR. Pass `--state ~/.config/hypertask-videos/storageState-qa.json` (user 985) so the flag is on, or you will screenshot the old UI and not notice. Keep the PNG path in this session's notes.
7. **Run `update-docs`** — a flagged feature is, by definition, a user-visible behaviour change.
8. **Run `simplify-before-pr`.** The feature works and the tests pass — now simplify the diff before anyone reviews it.
9. **Run `design-compliance`.** The diff is final. Now prove the new UI matches the style guide and that `node scripts/design-lint.mjs` is clean, before `design-gate` says so on the PR.
10. **Write the PR body** into a file (Summary for non-engineers first, plus the five sections `open-pr.sh` checks), then open the PR:
   ```
   .claude/skills/fix-bug/scripts/open-pr.sh <PREFIX-NNN> FEATURE "<short title>" \
     --body-file <path> [--lane <lane>]
   ```
   Same script `fix-bug` uses; `FEATURE` sets the title to `HTPR-NNNN [FEATURE] ...`. Default lane `ai-review` is right for an ordinary flagged feature. The helper leaves auto-merge off in every lane. This session merges after required checks are green.
   **If the feature needs a database migration:** an additive migration behind the flag stays on `ai-review`. A destructive migration uses `--lane valentin-review`.
   Keep the pull request URL in this session's notes.
11. **Expect the `feature-flag-gate` check.** It mechanically blocks a new-feature PR that omits the flag. It lets valid `[BUGFIX]` or `[INFRA]` titles through within the 150-added-UI-line limit; verified auto-reverts retain their exemption. A title is only a mechanical hint: the reviewer must check the diff for a genuine restoration of intended behaviour. API-only changes fall outside the mechanical check but the server-side rule in step 5 still applies, and no mechanical exemption waives semantic review or the required bugfix flag. Only `kind: "bugfix"` registry entries may default to Everyone; feature and improvement defaults must remain Owner + QA.
12. **After the production deployment for the merge sha is success, run `verify-qa`.** Name the flag key in the ticket comment. An open PR or a preview is not ready for that check. Use user 985 for the flag-on path and user 2343 for the flag-off path.
13. **The moment the flagged feature is live on production**, post a ticket comment via `vcc` that @mentions Valentin with the flag key, one line on what it does, and the link `https://app.hypertask.ai/admin/flags`. The mention markup is:
   `<span data-type="mention" class="mention" data-id="Valentin Yeo" data-label="name-6">Valentin Yeo</span>`
   Without the mention he never learns the flag exists.
14. **After a flag has stayed on Everyone for 14 days**, open a follow-up ticket to remove the flag and its dead branch.

## Notes

- Features stay behind the Owner+QA flag. They do not get the "bug fixes may deploy directly to production" exception that `fix-bug` has.
- UX and design decisions inside the feature never park a ticket in `Valentin Review`. He judges the real thing behind the flag in the app, not a wireframe.
