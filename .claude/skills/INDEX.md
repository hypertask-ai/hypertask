# Product Bot skills index

## Read the company pack first

**The company pack is read first, at `$COMPANY_SKILLS_DIR/INDEX.md`, every run.** `$COMPANY_SKILLS_DIR` is exported by the runner and points at the installed company-skills plugin, falling back to `~/projects/company-skills` when the plugin is not installed. It
carries how a bot operates in this company: `ticket-lifecycle`,
`hypertask-conventions`, `knowledge`, `talk-to-valentin`, `keep-docs-current`,
`analytics`, and the supervisor. Those rules hold for all four bots (Product,
Growth, Support, Finance) and none of them are repeated here.

This file carries only what is about **building the Hypertask product**: the
app repo, its flags, its QA, its docs site.

`RULES-product.md` next to this file is the product half of the rules. The
company half is `RULES.md` in the company pack.

Read the trigger column, open the SKILL.md whose trigger matches, and follow it
including its scripts. Scripts are referenced repo-relative from the repo
root inside each skill, because the runner's cwd is this checkout.

For a tool rather than a skill, read `TOOLS.md` **in the company pack**: it
covers both packs' scripts.

## Product skills

| Name | Trigger | Path |
|---|---|---|
| fix-bug | Ticket in Bugs describing wrong behaviour on app.hypertask.ai, where the fix restores documented or obviously intended behaviour rather than adding something new. The result may well be visible. | .claude/skills/fix-bug/SKILL.md |
| ship-feature-behind-flag | Ticket asking for new UI or behaviour the user has not seen before | .claude/skills/ship-feature-behind-flag/SKILL.md |
| reuse-existing-ui | Any ticket that adds or changes UI, before writing a line of code | .claude/skills/reuse-existing-ui/SKILL.md |
| simplify-before-pr | After the change works and tests pass, before opening the PR (`fix-bug` and `ship-feature-behind-flag` both call it right before their PR step) | .claude/skills/simplify-before-pr/SKILL.md |
| design-compliance | A ticket whose UI change works, before the PR: prove it matches the style guide and the `design-gate` check will pass (`reuse-existing-ui` runs before the code, this runs after) | .claude/skills/design-compliance/SKILL.md |
| update-docs | Any ticket that changes what a user sees, before opening the PR. The Hypertask docs-site specifics; the rule behind it is `keep-docs-current` in the company pack | .claude/skills/update-docs/SKILL.md |
| verify-on-phone | Any ticket touching UI, before opening the PR | .claude/skills/verify-on-phone/SKILL.md |
| verify-qa | A ticket in QA with label skills-pilot; verify the shipped change on production before it can be Done | .claude/skills/verify-qa/SKILL.md |
| security-findings | Not a skill of its own: `fix-bug/reference/security-findings.md`, read from `fix-bug` when a change touches auth, billing, or user data | .claude/skills/fix-bug/reference/security-findings.md |

## The flag rule

A change that restores documented or obviously intended behaviour ships without
a flag. Anything a user would experience as new goes behind a flag. When
unsure, flag it. (Matches the top of `fix-bug/SKILL.md` word for word.)

## Where things live now, 2026-09-15

The product skills moved here, into this repo, at `.claude/skills/`: the
runner reads them straight from the checkout each run works in, instead of a
separate skills repo. Growth, Support and Finance stay where they were, in
`hypertask-ai/agent-skills` (https://github.com/hypertask-ai/agent-skills) —
they are not Product Bot's skills, and this repo does not carry them. The
skills every bot shares, regardless of pack, are the `company-skills` plugin
(https://github.com/hypertask-ai/company-skills). `RULE-MAP.md` in this folder
still traces every source rule to the skill that carries it, across both
packs.
