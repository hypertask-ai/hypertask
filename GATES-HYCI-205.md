# GATES: HYCI-205 weekly live check on fleet board with current pstack

## Gate 1: Weekly live workflow exists on a GitHub-hosted runner and files to board 11514
CHECK: grep -q "5 4 \* \* 1" .github/workflows/visual-regression.yml && grep -q "runs-on: ubuntu-latest" .github/workflows/visual-regression.yml && grep -q "project-11514" .github/scripts/feature-map-live-weekly-file.mjs
EXPECT: exit 0

## Gate 2: Upkeep guide names pstack 0.15.36 and drops the archived-board pointer
CHECK: grep -q "pstack 0.15.36" .claude/skills/maintain-verification-skill/SKILL.md && ! grep -q "project 4060" .claude/skills/maintain-verification-skill/SKILL.md
EXPECT: exit 0

## Gate 3: PR merged to production with every required check green
MANUAL: PR URL, merge commit SHA, ci-wait exit 0.

## Gate 4: One live weekly check ran and its result is on a ticket on board 11514
MANUAL: production workflow_dispatch run URL plus the filed weekly ticket URL with pass/fail counts.

## Gate 5: Ticket Done with evidence
MANUAL: HYCI-205 in Done with the run and ticket links.
