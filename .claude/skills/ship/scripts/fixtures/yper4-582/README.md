# YPER4-582 read-only GitHub fixtures

Captured 2026-10-22 from production CI runs 39719731623 and 39765957007, their last green runs, squash commit ranges and GitHub PR file lists. Logs retain only the failing-test summary. Tasks retain only assigned-agent fields from `hypertask tasks get`.

`crossed-1777-1789.json` isolates those two real PRs for the ticket's crossed-merge example: #1777 touched `tests/htpr-7322-agent-feature-discovery.test.cjs`; #1789 did not, so #1777's Runner 6 wins. In the **actual** run 39719731623 range, #1777 is already before the last green commit, no PR touched that file, so #1789 (Runner 6) wins by matching the removed `pickDecisionTaskIds` export to the failing error identifier (its real patch is read during the live replay).

For run 39765957007 the range includes #1837 and #1835 (plus #1838 and #1832); #1835 touched the failing onboarding test and wins (Runner 5).

Run metadata includes `run_attempt`. Collection tests mock GitHub's paginated compare endpoint (oldest first), never local git; a 251-commit case proves full-range pagination and newest-first attribution. Rerun fixtures exercise both continuous failure and a new same-SHA streak after green.
