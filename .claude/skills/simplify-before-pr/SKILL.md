---
name: simplify-before-pr
description: After the change works and tests pass, before opening the PR
---

# simplify-before-pr

Use with `fix-bug` or `ship-feature-behind-flag`, as the step right before "Open the PR". Ported from Anthropic's `code-simplifier` plugin (see `reference/source.md` for the original and what was dropped or changed).

Scope is the ticket's own diff, nothing else: `git diff --name-only pub/production...HEAD`. Only touch files that command lists. A file that clearly needs the same treatment but wasn't touched by this ticket belongs to a different ticket, not this pass. (Check `git remote -v` if `pub` doesn't resolve in your checkout.)

## Steps

1. **List the touched files.** `git diff --name-only pub/production...HEAD`. This is the whole scope for this pass.
2. **Read each file's diff, not the whole file.** You're simplifying what this ticket changed, not auditing code that was already there.
3. **Preserve functionality.** Never change what the code does, only how it does it. All original features, outputs, and behaviour must remain intact.
4. **Enhance clarity** (from the source plugin, kept close to its own wording):
   - Reduce unnecessary complexity and nesting.
   - Eliminate redundant code and abstractions.
   - Improve readability through clear variable and function names.
   - Consolidate related logic.
   - **Comment Sicko:** keep a code comment only when it explains a non-obvious reason. Delete comments that restate the code. Stay inside this ticket's diff. Source: pstack no-comments, https://github.com/cursor/plugins/tree/main/pstack.
   - Avoid nested ternary operators — prefer switch statements or if/else chains for multiple conditions.
   - Choose clarity over brevity — explicit code is often better than overly compact code.
5. **Maintain balance — leave these alone** (also from the source plugin, kept close to its own wording). Avoid over-simplification that could:
   - Reduce code clarity or maintainability.
   - Create overly clever solutions that are hard to understand.
   - Combine too many concerns into single functions or components.
   - Remove helpful abstractions that improve code organization.
   - Prioritize "fewer lines" over readability (e.g. nested ternaries, dense one-liners).
   - Make the code harder to debug or extend.
6. **Re-run the tests you ran for the fix itself.** Same command, same scope as the ticket's own test step. They must still pass with no changes to what they assert.
7. **Commit the simplification separately from the fix**, so the reviewer can see the two apart:
   ```
   git commit -m "Simplify: <PREFIX-NNN>"
   ```
   If step 4 and 5 found nothing worth changing, skip the commit — an empty simplify commit is not evidence of anything.
8. **Record the result in this session's notes.** If you committed a simplify pass, note the commit sha. If step 7 was skipped because there was nothing to simplify, note that reason.

## Check before hand-off

- [ ] Tests are still green after the simplify pass
- [ ] No behaviour changed, only structure, naming, and duplication
- [ ] No new abstractions added (no helper, wrapper, or class introduced for single use)
- [ ] Diff is the same size or smaller than before the pass
- [ ] A separate commit exists for the simplify pass (`Simplify: <PREFIX-NNN>`), referenced as the gate's evidence

## Notes

- This is a quality pass, not a bug hunt. It doesn't look for correctness issues. If you spot one while reading, file it as its own ticket instead of fixing it here.
- The source plugin's own scope rule was "recently modified code in the current session." This skill uses the ticket's git diff instead, so a simplify pass stays inside the ticket.
