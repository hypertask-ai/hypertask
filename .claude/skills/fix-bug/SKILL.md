---
name: fix-bug
description: Ticket in Bugs describing wrong behaviour on app.hypertask.ai
---

# fix-bug

Use with `ticket-lifecycle` (board mechanics), `simplify-before-pr` and `design-compliance` (right before the PR step) and, if the change is visible on screen, `verify-on-phone` before the PR.

**Flag rule (matches `INDEX.md`'s "Two rules that sit above all five" word for word):** a change that restores documented or obviously intended behaviour ships without a flag. Anything a user would experience as new goes behind a flag. When unsure, flag it.

**Hard rule (Valentin, 2026-09-14 night):** every change a user could notice ships behind a feature flag enabled only for Owner and QA. Only Valentin widens a flag to everyone. A PR that enables a flag for all users, removes a flag gate, or changes default-on state is not self-mergeable: park it in `Valentin Review` with one line. A bug fix that changes visible behaviour still goes behind a flag unless it restores exactly the documented behaviour; when unsure, flag it, and make the flag-off default explicit (`DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA"` in `src/lib/flags.ts`, or the flag's own registration if narrower).

This skill covers the flag-exempt fixes: a crash, a 500, wrong or lost data, restoring exactly the prior behaviour, performance work with identical output, a security fix, a dependency or CI change, a spelling correction. **"Flag-exempt" is not the same as "invisible".** Restoring a broken screen changes what is on it, and a spelling fix changes what a user reads. So step 7 still applies whenever the result shows up on screen: no flag, but still a phone screenshot. If the fix would add or change behaviour a user has never seen before (not a restoration), read `ship-feature-behind-flag` step 2 and decide there before you start.

## Steps

1. **If the ticket touches UI, run `reuse-existing-ui` first.** Before writing a line of code for any bug whose fix changes what's on screen, work through `reuse-existing-ui/SKILL.md`: list the UI elements the fix needs and reuse the existing component for each. A bug fix that quietly rebuilds a component instead of fixing the real one is not a fix.
2. **Reproduce on production first.** Before touching code, confirm the bug is real on `https://app.hypertask.ai` right now: `curl` the affected endpoint, or drive it with `agent-browser` for a UI bug. If you cannot reproduce it, say so on the ticket and stop. Do not guess at a fix. A ticket filed by the Strix scanner needs the read-only variant of this step: see `reference/security-findings.md`.
3. **Trace the entry point.** Before editing, follow the change through middleware, route handler, controller or service layer, queue side effects, auth and cookie behaviour, and realtime/cache invalidation where relevant. Business logic usually lives in `src/utils/controllers/`, not in the route file.
4. **Write a failing test** that captures the reported behaviour. It must fail before your fix and pass after. It must exercise the real production implementation or its real external boundary, never a copied implementation plus string-matching the source. For clipboard file bugs, drive the real paste handler with `DataTransfer.items` and `DataTransfer.files` independently because browsers may populate only one collection; assert that the event is consumed, content is inserted, and the original file reaches the upload boundary.
5. **Fix the bug** with the smallest diff that resolves it. Do not refactor unrelated code. See `ticket-lifecycle` "Acceptance criteria decide Done" for what to do with optional improvements. Cleanup jobs must identify resources owned by the current run, such as with a unique name, label, or network; never remove every resource sharing an image or type.
6. **Run the relevant tests** (not the whole suite unless the change is broad) on the same Node major CI uses, plus a fresh typecheck. Fix test loading through the repo's own test helpers; never convert a `.ts` file to `.js` just to satisfy an import. Mark the matching gate met with the test output as evidence: `$COMPANY_SKILLS_DIR/ticket-lifecycle/scripts/gates.sh met <PREFIX-NNN> "<gate>" --evidence "<test output>"` (`$COMPANY_SKILLS_DIR` is exported by the runner and points at the installed company-skills plugin, falling back to `~/projects/company-skills` when the plugin is not installed).
7. **Take the phone screenshot** if the result is visible on screen at all: `verify-on-phone`, before the PR, not after. Skip it only for a change with no rendered output, such as a dependency bump, a CI workflow, or a server-side-only fix. Mark that gate met with the `phone-shot.sh` PNG path as evidence.
8. **Write the PR body first** with `talk-to-valentin` (company pack), into a file. The script needs `--body-file`; there is no `--fill` shortcut, because `--fill` would drop the "Summary for non-engineers" section.
9. **Run `update-docs`** if a user-visible behaviour changed.
10. **Run `simplify-before-pr`.** The change works and the tests pass — now simplify the diff before anyone reviews it.
11. **Run `design-compliance`.** The diff is final. Now prove the UI matches the style guide and that `node scripts/design-lint.mjs` is clean, before `design-gate` says so on the PR.
12. **Open the PR:**
   ```
   .claude/skills/fix-bug/scripts/open-pr.sh <PREFIX-NNN> BUGFIX "<short title>" \
     --body-file <path> [--lane <lane>]
   ```
   It pushes the current branch, opens the PR against `production`, titles it `HTPR-NNNN [BUGFIX] ...`, sets auto-merge to match the lane, moves the ticket, and reads the board back. It does not branch or commit: do that first. Default lane is `ai-review`.
   **Lane by risk:** see `ticket-lifecycle` step 9 for the lane table (including the additive-migration exception) and pick `--lane` from there.
   Mark the PR gate met with the PR URL as evidence: `$COMPANY_SKILLS_DIR/ticket-lifecycle/scripts/gates.sh met <PREFIX-NNN> "<gate>" --evidence "<PR URL>"`.
12. **Request full CI if the workflow would otherwise skip it**, and confirm required checks and review pass on the final commit head before hand-off. A skipped test job is not a pass. If checks read green but GitHub still blocks the merge, look for cancelled duplicate runs of those required jobs and rerun only those, one at a time. Never bypass branch protection and never toggle a label to force a merge green.
13. **Re-read the ticket's latest comments before merging.** A green CI run does not override a correction posted after it. Don't restart a full review cycle for a small follow-up fix; a fresh look at the delta on top of the already-reviewed diff is enough.
14. **Hand to QA** with a ticket comment naming the PR, what to check, and any access QA needs to reach it (login, feature flag, URL) so it isn't blocked chasing that itself.

## Conventions (from `~/projects/hypertasks/AGENTS.md` and `~/.claude/CLAUDE.md`)

- **A ticket labeled `cli` is fixed in `~/projects/hypertask-cli-zig` (remote `hypertask-ai/cli`, PRs base `main`), not in this app worktree.** This is the live native CLI: `~/.local/bin/hypertask` is built from it, and it is what `ticket-lifecycle` rule 4/RULE-MAP #63 already points at. `~/projects/hypertask-mcp` also contains a folder called `CLI/`, but that is the **retired Node package** (`@hypertask/hypertask_cli`) — AGENTS.md says explicitly not to extend it. Fixing a `cli`-labeled ticket there ships a change nobody runs. See RULE-MAP #99 for how this got checked.
- Branch off `<remote>/production` of `hypertask-ai/hypertask`. Never base work on the legacy `valentinyeo/hypertasks` repo, which is what `origin` points at in some older checkouts. The script uses `$HT_GIT_REMOTE` (falling back to `origin`); check `git remote -v` if you are unsure which is which.
- PR base is `production`, never `main`. `main` is frozen legacy. Title format is `HTPR-NNNN [TYPE] ...`.
- Merging to `production` deploys `app.hypertask.ai` in about three minutes. **Bug fixes may deploy directly**, severe ones especially, and QA checks them on production afterwards. Features do not get this: they stay behind the Owner+QA flag.
- Auto-merge is per-PR and opening the PR does not turn it on. The script enables it on the `ai-review` lane and deliberately leaves it off on the other two.
- Previews are opt-in and share the live production database. Visual verification only, never destructive testing. Never poll a building preview by reloading a browser tab: poll headlessly with `curl -o /dev/null -w '%{http_code}'` or `gh pr checks`, and open the browser only once it is ready.
- If `gh pr edit` fails on an old gh version, use the REST PATCH endpoint with a JSON body file. Never interpolate prose into shell code.
- Never open a duplicate PR because an existing branch looks awkward. Recover it instead.
