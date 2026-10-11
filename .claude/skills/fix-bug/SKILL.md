---
name: fix-bug
description: Ticket in Bugs describing wrong behaviour on app.hypertask.ai
---

# fix-bug

Use with `simplify-before-pr` and `design-compliance` (right before the PR step) and, if the change is visible on screen, `verify-on-phone` before the PR. After the deploy, run `verify-qa` yourself. Board writes go through `vcc`.

**Flag rule (matches `INDEX.md`):** a real bug fix restores behaviour that used to work or was clearly intended. Bug fixes ship behind a ticket-named flag with `kind: "bugfix"`, on for Everyone by default (Valentin, 2026-10-06). Fixes to saved data, security and crashes keep shipping with no flag. Bugfix flags get the same cleanup after 14 days on Everyone. Feature and new-behaviour flags still default Owner + QA; developers never switch a feature flag to Everyone. A `[BUGFIX]` title is only a hint to the mechanical gate. The reviewer decides from the diff whether it really restores intended behaviour; new visible behaviour dressed as a fix still needs a flag.

Any change to code inside a flag that is already on for Everyone, whatever its PR type ([BUGFIX] included), needs one recorded browser click-through of the changed path on a real board before merge, on the preview or locally against the PR build, with the live flag states. Record commit, account and flag state in ~/.local/state/vcc-evidence/<TICKET>/premerge.md.

Only Valentin widens a feature flag to Everyone. A new bugfix flag defaulting to Everyone follows the bugfix rule above. A PR that widens an existing flag, removes a flag gate, or changes a feature default-on state is not self-mergeable: park it in `Valentin Review` with one line.

This skill covers bug fixes such as crashes, 500s, wrong or lost data, and restoring intended behaviour, as well as performance work with identical output, security fixes, dependency or CI changes, and spelling corrections. **"Flag-exempt" is not the same as "invisible".** Restoring a broken screen changes what is on it, and a spelling fix changes what a user reads. So step 7 still applies whenever the result shows up on screen: with or without a flag, still a phone screenshot. If the change introduces new behaviour or design rather than fixing a bug, use `ship-feature-behind-flag`.

## Before coding and helper prompts

For the `valentin-review` lane only (money, login and access, security, data that cannot be undone), load `interrogate` before coding. Ordinary `ai-review` work keeps the existing ai-review check and must not use `interrogate`.

Give helpers the ticket scope, observed cause and failing check. Point them at these short principles, not a whole playbook:

- `.claude/skills/fix-bug/principles/fix-root-causes.md`
- `.claude/skills/fix-bug/principles/prove-it-works.md`
- `.claude/skills/fix-bug/principles/test-behavior-not-implementation.md`

## Steps

1. **If the ticket touches UI, run `reuse-existing-ui` first.** Before writing a line of code for any bug whose fix changes what's on screen, work through `reuse-existing-ui/SKILL.md`: list the UI elements the fix needs and reuse the existing component for each. A bug fix that quietly rebuilds a component instead of fixing the real one is not a fix.
2. **Reproduce on production first.** Before touching code, confirm the bug is real on `https://app.hypertask.ai` right now: `curl` the affected endpoint, or drive it with `agent-browser` for a UI bug. If you cannot reproduce it, say so on the ticket and stop. Do not guess at a fix. A ticket filed by the Strix scanner needs the read-only variant of this step: see `reference/security-findings.md`.
3. **Trace and confirm the cause.** Before editing, follow the change through middleware, route handler, controller or service layer, queue side effects, auth and cookie behaviour, and realtime/cache invalidation where relevant. Business logic usually lives in `src/utils/controllers/`, not in the route file. Watch the app run in a browser, inspect runtime logs, or run a failing behaviour test that confirms the proposed cause. Reading code alone is not proof. Record the observation before writing the fix.
4. **Write a failing test** that captures the reported behaviour. It must fail before your fix and pass after. It must exercise the real production implementation or its real external boundary, never a copied implementation plus string-matching the source. For clipboard file bugs, drive the real paste handler with `DataTransfer.items` and `DataTransfer.files` independently because browsers may populate only one collection; assert that the event is consumed, content is inserted, and the original file reaches the upload boundary.
5. **Fix the bug** with the smallest diff that resolves it. Unless it fixes saved data, security or crashes (or another existing non-product exemption applies), add only one client-safe file `src/lib/flags/definitions/<flag-key>.ts`, exporting its key constant and a default definition with `kind: "bugfix"` and `releaseRisk: { risk, reason }`, default Everyone. Do not edit shared registry files or test lists, and never commit `index.generated.ts`. Add per-flag tests in their own test file, and gate the fix on the client and server where relevant. Do not reuse another ticket's flag. After it ships, record the production release date and persist its Everyone mode through the approved flags API/admin UI so the existing 14-day cleanup countdown starts; never widen a feature flag. Create the cleanup follow-up after 14 days on Everyone. Do not refactor unrelated code. File an optional improvement as its own ticket. Cleanup jobs must identify resources owned by the current run, such as with a unique name, label, or network; never remove every resource sharing an image or type.
6. **Run the relevant tests** (not the whole suite unless the change is broad) on the same Node major CI uses, plus a fresh typecheck. Fix test loading through the repo's own test helpers; never convert a `.ts` file to `.js` just to satisfy an import. Keep the command and its result in this session's notes. If a fix fails a check, undo only your change motivated by that cause, then question and re-test the cause before trying again. Never stack a second fix on an unproven first one. Do not revert anyone else's changes.
7. **Take the phone screenshot** if the result is visible on screen at all: `verify-on-phone`, before the PR, not after. Skip it only for a change with no rendered output, such as a dependency bump, a CI workflow, or a server-side-only fix. Keep the `phone-shot.sh` PNG path in this session's notes. If the ticket's area has a `verify-qa/reference/feature-map/*.md` file, also capture the "before" shot from that file's proof section on production, while the bug still reproduces. `verify-qa` takes the "after" shot once the fix is deployed.
8. **Write the PR body first**, into a file. Start with "Summary for non-engineers" (the problem, what changed, what looks different, risks). The script needs `--body-file` and the five sections it checks (a first action line, What went wrong, What changes, What you will see, Watch out for). There is no `--fill` shortcut, because `--fill` would drop that summary.
9. **Run `update-docs`** if a user-visible behaviour changed.
10. **Run `simplify-before-pr`.** The change works and the tests pass — now simplify the diff before anyone reviews it.
11. **Run `design-compliance`.** The diff is final. Now prove the UI matches the style guide and that `node scripts/design-lint.mjs` is clean, before `design-gate` says so on the PR.
12. **Open the PR:**
   ```
   .claude/skills/fix-bug/scripts/open-pr.sh <PREFIX-NNN> BUGFIX "<short title>" \
     --body-file <path> [--lane <lane>]
   ```
   It pushes the current branch, opens the PR against `production`, titles it `HTPR-NNNN [BUGFIX] ...`, leaves auto-merge off, moves the ticket with `vcc`, and reads the board back with `hypertask`. It does not branch or commit: do that first. Default lane is `ai-review`.
   **Lane by risk:** `ai-review` for an ordinary bug fix and for an additive migration behind a flag (the ticket stays In Progress; Valentin, 2026-10-10). `valentin-review` for money, auth, security, irreversible data, a destructive migration, or a pull request that widens a flag. Post one question. Never assign userId 6.
   Keep the pull request URL in this session's notes.
13. **Request full CI if the workflow would otherwise skip it**, and confirm required checks and review pass on the final commit head before you merge. A skipped test job is not a pass. If checks read green but GitHub still blocks the merge, look for cancelled duplicate runs of those required jobs and rerun only those, one at a time. Never bypass branch protection and never toggle a label to force a merge green.
14. **Re-read the ticket's latest comments before merging.** A green CI run does not override a correction posted after it. Don't restart a full review cycle for a small follow-up fix; a fresh look at the delta on top of the already-reviewed diff is enough.
15. **After the production deployment for the merge sha is success, run `verify-qa`.** You verify the live app. A separate checker does not.

## Conventions (from `~/projects/hypertasks/AGENTS.md` and `~/.claude/CLAUDE.md`)

- **A ticket labeled `cli` is fixed in `~/projects/hypertask-cli-zig` (remote `hypertask-ai/cli`, PRs base `main`), not in this app worktree.** This is the live native CLI: `~/.local/bin/hypertask` is built from it. See RULE-MAP #63 and #99. `~/projects/hypertask-mcp` also contains a folder called `CLI/`, but that is the **retired Node package** (`@hypertask/hypertask_cli`) — AGENTS.md says explicitly not to extend it. Fixing a `cli`-labeled ticket there ships a change nobody runs.
- Branch off `<remote>/production` of `hypertask-ai/hypertask`. Never base work on the legacy `valentinyeo/hypertasks` repo, which is what `origin` points at in some older checkouts. The script uses `$HT_GIT_REMOTE` (falling back to `origin`); check `git remote -v` if you are unsure which is which.
- PR base is `production`, never `main`. `main` is frozen legacy. Title format is `HTPR-NNNN [TYPE] ...`.
- Merging to `production` deploys `app.hypertask.ai` in about three minutes. **Bug fixes may deploy directly**, severe ones especially, and this session checks them on production afterwards with `verify-qa`. Features do not get this: they stay behind the Owner+QA flag.
- Opening a PR is a review handoff. `open-pr.sh` never merges and never enables auto-merge. After required checks are green, this session merges.
- Previews are opt-in and share the live production database. Visual verification only, never destructive testing. Never poll a building preview by reloading a browser tab: poll headlessly with `curl -o /dev/null -w '%{http_code}'` or `gh pr checks`, and open the browser only once it is ready.
- If `gh pr edit` fails on an old gh version, use the REST PATCH endpoint with a JSON body file. Never interpolate prose into shell code.
- Never open a duplicate PR because an existing branch looks awkward. Recover it instead.
