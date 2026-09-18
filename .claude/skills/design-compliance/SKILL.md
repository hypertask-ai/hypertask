---
name: design-compliance
description: A ticket whose UI change works, before the PR. Prove it matches the style guide
---

# design-compliance

Use after the UI change works and before you open the PR, in the same slot as
`simplify-before-pr`. `fix-bug` and `ship-feature-behind-flag` both call it there.

This is not `reuse-existing-ui`. That one runs **before** you write code and
decides which component you reuse. This one runs **after** the code works and
proves the result matches the guide, so the `design-gate` check cannot surprise
you on the PR. Run both; they do not overlap.

The app repo is `~/projects/hypertask-oss`.

## Steps

1. **Read the guide.** `docs/design/STYLE-GUIDE.md` in the app repo. It is the
   checkable subset: the scales, the canonical component per job, the reference
   screens, and the ten-item do-not list. `openwiki/style-guide.md` is canonical
   for anything it omits, and wins when the two disagree.

2. **Open the reference screens and compare.** Your change has to look like it
   belongs next to these:

   | Screen | Route |
   |---|---|
   | Kanban board | `/[...boardURL]` |
   | Task detail | `/detail/[...slug]` |
   | Inbox | `/inbox` |
   | Settings | `/settings/[[...section]]` |
   | Mobile comment field | task detail on a phone |

   Open the real app, not a memory of it. The mobile comment field is the
   reference for shape, spacing, tokens, icons and action hierarchy together.

3. **Run the lint before the PR, not after.**

   ```bash
   cd ~/projects/hypertask-oss
   node scripts/design-lint.mjs
   ```

   It checks the lines your branch added against the production merge base. Exit
   0 is clean, exit 1 lists file, line, rule and fix. Fix every finding. It is
   the same script CI runs, so a clean run here is a green `design-gate` there.

   If you touched `tailwind.config.ts`, also run
   `node scripts/design-lint.mjs --verify-tokens`.

   **Do not add a line to `docs/design/lint-allow.txt` to get past a finding.**
   An allowlist entry is an owner-approved design exception with a ticket behind
   it, and CI reads that file from production anyway, so editing it on your
   branch changes nothing. Fix the code.

4. **Check the two things the lint cannot see.**
   - **One primary action per control group**, last in the action order, using
     `bg-shadcn-primary`. Secondary and ghost actions stay borderless.
   - **No new on-canvas chrome.** A new button, pill, badge or banner on a task,
     board, feed or detail surface breaks the product. A new affordance goes
     into a keyboard shortcut plus the Ctrl+K palette plus the `?` cheatsheet.
     `docs/DESIGN.md` in the app repo shows how to register one.

5. **New screen only: attach a wireframe and wait for a word.** A *new screen*
   means a route that does not exist yet. Changing an existing screen never
   needs a wireframe: ship it behind the flag per `ship-feature-behind-flag`
   and let the owner judge the real thing in the app.

   For a genuinely new screen, build the wireframe as an HTML page **from the
   app's real components**, not from an invented design. Read the markup of the
   components you are composing and reuse their real classes and tokens. A mock
   showing controls the product does not have wastes the review and misleads the
   fix.

   Attach it to the ticket as a page, then post one comment:

   - page: the CLI's `pages create` command, with `--task <numeric task id>`,
     `--title "Wireframe"`, `--markdown-file mock.html`, `--html` and `--canvas`
   - comment: `Wireframe attached, reply go or change.` wrapped in `<p>` tags

   `--task` takes the numeric id from the ticket read command, not `PREFIX-NNN`.
   Use your own agent identity's CLI, never the owner's token, and never write on
   the board as the owner. Then wait for the reply. Build what the reply says.

6. **Say it in the PR.** One line in the PR body: which reference screen the
   change matches, and that `design-lint` is clean. If a finding is an approved
   exception, name the ticket that approved it.

## Check before hand-off

- [ ] `node scripts/design-lint.mjs` exits 0 on the branch
- [ ] The change was compared against at least one reference screen, open in the real app
- [ ] One primary action per control group, and no new on-canvas chrome
- [ ] A new screen has a wireframe page on its ticket and a reply saying go
- [ ] The PR body names the reference screen and the clean lint

## Notes

- The lint reads **added lines only**. It will never ask you to repair drift you
  did not touch, and you should not volunteer to: that is a different ticket.
- `design-gate` is in the automerge required list. A violation blocks the merge
  and posts the findings as a PR comment, so running step 3 locally is the
  cheapest place to find them.
- The model half of the design review is `claude-review`, which reads the review
  contract at the end of `openwiki/style-guide.md`. It reviews component reuse,
  action hierarchy and new chrome; it does not re-report what the lint catches.
