---
name: ship-feature-behind-flag
description: Ticket in Features asking for new UI or behaviour
---

# ship-feature-behind-flag

Use with `ticket-lifecycle` (company pack) (board mechanics), `verify-on-phone` (before the PR), `simplify-before-pr` and `design-compliance` (right before the PR step), and `talk-to-valentin` (company pack) (the PR body).

## Steps

1. **If the ticket touches UI, run `reuse-existing-ui` first.** Before writing a line of code, work through `reuse-existing-ui/SKILL.md`: list the UI elements the feature needs and reuse the existing component for each. A new feature that quietly rebuilds a component the app already has is not "new UI", it's duplicated UI.
2. **Decide whether this ticket needs a flag.** Every new feature, screen, control, shortcut, API route, or user-visible behaviour change needs one, even when the ticket is labelled a bug. The label does not decide, the effect does: if a user will see, click, type, or read anything differently (layout, wording, flow, timing, defaults, shortcuts, embeds, autocomplete), it needs a flag. Use `fix-bug` without a flag only when nothing visible changes: a fix that restores exact prior behaviour, performance work with identical output, a security fix, a dependency or CI change, a spelling correction, or a ticket carrying the **AI CHAT 💬** label. When in doubt, add the flag. An unneeded flag costs one cleanup ticket; a shipped UX change without one costs a rollback.
3. **Find the flag mechanism.** The repo gates new UI and behaviour with `useFlag("htpr-NNNN-slug-name")`. The registry is `src/lib/flags.ts`: each flag is a constant exported from there and imported by its callers, for example `HTPR_6157_AUTO_DESCRIPTION_FLAG`. Name yours `htpr-<ticket-number>-<short-slug>`, matching the pattern every existing flag in that file uses. Never reuse a flag for a different feature.
4. **Register the flag** in `src/lib/flags.ts` with `DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA"`, the repo default: Valentin and the QA account see it, nobody else. Only Valentin widens a flag's release, at `/admin/flags`. Never release to Everyone yourself.
5. **Gate the change** on that flag with `useFlag(...)` at the point the new UI or behaviour renders or runs, **and gate the protected behaviour on the server too**. `useFlag` only hides client UI; it never replaces API authorization.
6. **Take the phone screenshot** with `verify-on-phone`, before the PR. The flag has to be on for the account whose auth state the script uses, or you will screenshot the old UI and not notice. Mark that gate met with the `phone-shot.sh` PNG path as evidence: `$COMPANY_SKILLS_DIR/ticket-lifecycle/scripts/gates.sh met <PREFIX-NNN> "<gate>" --evidence "<png path>"` (`$COMPANY_SKILLS_DIR` is exported by the runner and points at the installed company-skills plugin, falling back to `~/projects/company-skills` when the plugin is not installed).
7. **Run `update-docs`** — a flagged feature is, by definition, a user-visible behaviour change.
8. **Run `simplify-before-pr`.** The feature works and the tests pass — now simplify the diff before anyone reviews it.
9. **Run `design-compliance`.** The diff is final. Now prove the new UI matches the style guide and that `node scripts/design-lint.mjs` is clean, before `design-gate` says so on the PR.
10. **Write the PR body** with `talk-to-valentin` (company pack) into a file, then open the PR:
   ```
   .claude/skills/fix-bug/scripts/open-pr.sh <PREFIX-NNN> FEATURE "<short title>" \
     --body-file <path> [--lane <lane>]
   ```
   Same script `fix-bug` uses; `FEATURE` sets the title to `HTPR-NNNN [FEATURE] ...`. Default lane `ai-review` (auto-merge on) is right for an ordinary flagged feature.
   **If the feature needs a database migration:** see `ticket-lifecycle` step 9 for the lane table (including the additive-migration exception) and pick `--lane` from there.
   Mark the PR gate met with the PR URL as evidence: `$COMPANY_SKILLS_DIR/ticket-lifecycle/scripts/gates.sh met <PREFIX-NNN> "<gate>" --evidence "<PR URL>"`.
10. **Expect the `feature-flag-gate` check.** It mechanically blocks a feature or UI PR that omits the flag. It lets a `[BUGFIX]` or `[INFRA]`-titled PR through without one only when the diff adds at most 150 UI lines, or is a verified auto-revert. API-only changes fall outside the mechanical check but the server-side rule in step 5 still applies, and no exemption waives semantic review.
11. **Hand to QA** with a ticket comment naming the flag key exactly, so QA can turn it on for their own account.
12. **The moment the flagged feature is live on production**, post a ticket comment that @mentions Valentin with the flag key, one line on what it does, and the link `https://app.hypertask.ai/admin/flags`. The mention markup is:
   `<span data-type="mention" class="mention" data-id="Valentin Yeo" data-label="name-6">Valentin Yeo</span>`
   Without the mention he never learns the flag exists.
13. **After a flag has stayed on Everyone for 14 days**, open a follow-up ticket to remove the flag and its dead branch.

## Notes

- Features stay behind the Owner+QA flag. They do not get the "bug fixes may deploy directly to production" exception that `fix-bug` has.
- UX and design decisions inside the feature never block merge or auto-merge, and never park a ticket in `Valentin Review`. He judges the real thing behind the flag in the app, not a wireframe.
