# Rule map

Product rules a `/ship` session still follows, and the skill in this folder
that carries each one. Rows for retired bot identities were removed
on 2026-10-01 when those identities were shut down. Numbers are the original
ones, so older comments that cite them still point at the same rule.

| # | Rule | Skill |
|---|---|---|
| 5 | Request full CI when the workflow would skip it. A skipped test job is not a pass. | fix-bug |
| 6 | Required checks and review pass on the final commit before you merge. | fix-bug |
| 10 | Never bypass branch protection, and never toggle a label to force a merge. | fix-bug |
| 11 | If checks are green but GitHub still blocks, rerun only the cancelled duplicate required jobs, one at a time. | fix-bug |
| 12 | Never open a duplicate pull request. Recover the existing branch. | fix-bug |
| 16 | A bug fix deploys to production. Verify it there afterwards. | fix-bug, verify-qa |
| 16b | New behaviour stays behind the Owner + QA flag. | ship-feature-behind-flag |
| 17 | Fix the reported bug. File an optional improvement as its own ticket. | fix-bug |
| 23 | If `gh pr edit` fails, PATCH the pull request with a JSON file. Never interpolate the body into shell code. | fix-bug |
| 26 | Run the affected tests on CI's Node major, plus a fresh typecheck. Do not convert TypeScript to JavaScript to satisfy an import. | fix-bug |
| 27 | Re-read the ticket's latest comments before merging. A green CI run does not override a later correction. | fix-bug |
| 28 | Tests exercise the real implementation or its real boundary, not a copy plus a string match. | fix-bug |
| 29 | A UI pass needs a meaningful ready or empty state. A 200, an unchanged URL, or a fixed sleep is not proof. | verify-on-phone, verify-qa |
| 30 | Compare against a baseline when a blank page might be the correct empty state. | verify-on-phone |
| 32 | Screenshots show the acceptance criteria, not merely that a page loaded. | verify-on-phone, verify-qa |
| 34 | Never print cookies or a storage-state file. | verify-on-phone, verify-qa |
| 35 | Mobile and responsive changes need a real 390x844 screenshot on production. Anything less is not a pass. | verify-on-phone, verify-qa |
| 42 | Acceptance criteria decide done. An optional nice-to-have is a new ticket, filed in Bugs or Features. | fix-bug |
| 45 | Archive only fixtures you created, through the product UI, never SQL. | verify-qa |
| 58 | Ticket references are full URLs, including inside comments. | verify-qa |
| 59 | The final comment says the user-visible problem, what works now, and what the user will notice. | verify-qa |
| 63 | A `cli` ticket is fixed in `~/projects/hypertask-cli-zig` (`hypertask-ai/cli`, pull requests base `main`). Do not fix it in this app repo. | fix-bug |
| 67 | Never `git stash`. Never reset, check out, or revert files you did not change. | fix-bug |
| 68 | Before committing, run `git status --short --branch` and keep other sessions' dirty files out of the commit. | fix-bug |
| 69 | While a preview is building, poll with `curl` or `gh pr checks`. Do not reload a browser tab. | fix-bug |
| 70 | Never read or write ticket content through Prisma, SQL, or a database client. | fix-bug, verify-qa |
| 71 | Comments are HTML block tags. Link other tickets with `<a href>`. | verify-qa |
| 72 | Do not mix plain text and HTML in one `--text` value. | verify-qa |
| 76 | No pull request without a ticket. | fix-bug |
| 77 | Branch off `origin/production` of `hypertask-ai/hypertask`. The pull request targets `production`. | fix-bug |
| 78 | `open-pr.sh` leaves auto-merge off. The session merges after required checks are green. | fix-bug |
| 79 | Previews share the live database. Look only. No destructive testing. | fix-bug |
| 81 | Trace the entry point through middleware, route, controller, queue, auth, and cache before editing. | fix-bug |
| 82 | Every new feature, screen, control, shortcut, API route, or deliberate behaviour change needs one flag named `htpr-<ticket>-<slug>`. | ship-feature-behind-flag |
| 83 | New flags default to Owner + QA. Only Valentin widens one. | ship-feature-behind-flag |
| 84 | Gate protected behaviour on the server. `useFlag` only hides client UI. | ship-feature-behind-flag |
| 85 | A bug fix never gets a flag and ships to everyone, even when visible. | fix-bug |
| 86 | No flag for performance work with the same output, security fixes, dependency or CI changes, spelling fixes, or an AI CHAT ticket. | ship-feature-behind-flag |
| 87 | A `[BUGFIX]` title is not proof. New visible behaviour dressed as a fix needs a flag. | fix-bug, INDEX.md |
| 88 | The mechanical flag check may pass a `[BUGFIX]` or `[INFRA]` title within 150 added UI lines. The reviewer still decides from the diff. | ship-feature-behind-flag |
| 89 | After a flag has been on Everyone for 14 days, open a ticket to remove the flag and the dead branch. | ship-feature-behind-flag |
| 90 | When a flagged feature is live, comment on the ticket, @mention Valentin, name the flag, and link `https://app.hypertask.ai/admin/flags`. | ship-feature-behind-flag |
| 92 | Pull request title is `HTPR-NNNN [TYPE] ...`. | fix-bug |
| 93 | An additive migration behind a flag goes to AI Review. A destructive migration, and money, auth, security, or irreversible data, go to Valentin Review. Auto-merge stays off. | fix-bug, `open-pr.sh` |
| 95 | Claim and comment as `vcc`, never as userId 6. | verify-qa |
| 97 | Never assign userId 6 for any reason. If Valentin assigned himself or moved the ticket by hand, leave it. | verify-qa, `open-pr.sh` |
| 98 | When Valentin @mentions the session, the reply @mentions him back with the editor's mention markup. | verify-qa |
| 99 | A `cli` label routes to `hypertask-ai/cli`, not the retired Node package. | fix-bug |
| 100 | Reproduce the acceptance criteria on the deployed production revision before any verdict. | verify-qa |
| 101 | A UI ticket gets a real 390x844 production screenshot attached with `vcc comment add --attach`. | verify-qa |
| 102 | PASS moves the ticket to Done with the evidence attached. | verify-qa |
| 103 | FAIL moves the ticket back to In Progress and names the exact case. The same session fixes and ships again. | verify-qa |
| 104 | Never assign anyone on the verdict, and never assign userId 6. | verify-qa |
| 105 | When Valentin @mentions the session, the reply @mentions him back. | verify-qa |
| 108 | A small follow-up does not restart a full review. Review the delta. | fix-bug |
| 109 | Every docs `.mdx` page has `title` and `description` frontmatter. A page with an import is `.mdx`. | update-docs |
| 110 | Docs descriptions and code examples use HTML. | update-docs |
| 111 | The docs site deploys with `wrangler pages deploy`. A git push does not deploy it. | update-docs |
| 112 | Changelog source is board 15 `HTPR-*` tickets only. | update-docs |
| 113 | Changelog text is user-facing. No private cross-tenant bugs, no test tickets. | update-docs |
| 114 | Changelog entries are newest first, each linked to its ticket URL. | update-docs |
| 116 | A user-visible change updates the matching docs page in `hypertask-ai/docs` before or alongside the app pull request. | update-docs, fix-bug, ship-feature-behind-flag |
| 117 | New behaviour ships behind Owner + QA. Bug fixes do not. A pull request that widens a flag goes to Valentin Review. | fix-bug, ship-feature-behind-flag |
| 118 | `verify-qa` checks flag mode for flagged features and verifies bug fixes on production with no flag. | verify-qa |
| 119 | UI work reuses an existing component. A new component needs a reason on the ticket and in the pull request summary. | reuse-existing-ui |
| 120 | After the change works, simplify the diff in a separate commit. Do not change behaviour. | simplify-before-pr |
| 123 | A scanner finding is a candidate until you confirm it by reading the route or curling a local build. A confirmed security fix uses `--lane valentin-review`. | fix-bug, `reference/security-findings.md` |
| 126 | Before the pull request, a UI change matches the style guide and `node scripts/design-lint.mjs` exits 0. | design-compliance |

## Pstack additions

These rules live in skill text only. No hook or CI check enforces runner
compliance. The upkeep test checks the script, not the truth of its reports.

| Rule | Skill | Enforcement |
|---|---|---|
| Confirm the proposed bug cause by watching runtime behaviour before fixing it. | fix-bug | Skill text, not enforced |
| Undo your failed cause-driven fix and re-test the cause; never stack unproven fixes. | fix-bug | Skill text, not enforced |
| Helper prompts use fix-root-causes, prove-it-works and test-behavior-not-implementation principles, not a whole playbook. | fix-bug/principles | Skill text, not enforced |
| Prove material safety facts beyond the diff by running real code before the PR. | blast-radius, ship | Skill text, not enforced |
| Check measured numbers under matching conditions with repeated runs, variance and baseline vs after. | fix-slow-page | Skill text, not enforced |
| Before coding in valentin-review, judge design reviews from all three named Codex models. Ordinary ai-review must not use interrogate. | interrogate, ship | Skill text, not enforced |
| Keep code comments only for non-obvious reasons; remove code restatements. | simplify-before-pr | Skill text, not enforced |
| Weekly map upkeep reports source/live drift read-only, never as Valentin, with no edits or PR. | verify-qa, scripts/map-upkeep | Skill text for agent conduct, not enforced; script installs the timer and saves output |

## Logins

The session passes `--state` explicitly.

- `~/.config/hypertask-videos/storageState-qa.json` (user 985) sees Owner + QA flags.
- `~/.config/hypertask-videos/storageState-qa-normal.json` (user 2343) is the flag-off account.

Never point a shot at Valentin's own browser state.
