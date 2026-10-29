# CI runner placement policy

## How a customer reaches it

Production pull requests run PR Guards Trusted.
Its runner-policy step contributes to the required pr-title result.
The separate title step still binds the ticket.
No application screen changes.

## How to drive it

1. Confirm the merge's production deployment succeeded.
2. Fetch production and run the merged checker with `--repo hypertask-ai/hypertask --ref <production SHA>`.
3. Require live public visibility, ubuntu-latest and free standard minutes.
4. Read the current-head Ship scripts tests fixture log.
5. Confirm its trusted workflow entry rejects a self-hosted candidate and candidate checker/policy tampering.
6. Confirm valid runners pass, missing or stale runner verdicts fail, and ticket binding still works.
7. Run `~/projects/token-ladder/bin/token-ladder hook-prompt`.
8. Require the public app and free-hosted fact before closing the ticket.

## What usually breaks

- Candidate policy or checker controls its own approval.
- Missing or stale runner validation publishes a green title status.
- Runner validation breaks existing ticket binding.
- An unavailable visibility lookup becomes approval.
- A private hosted approval survives changed workflows.
- The separate reminder still teaches only the private-repository case.

## What proof to collect

Save merge/deployment metadata, hosted fixture output, and the live lookup.
The fixtures execute the actual workflow scripts and status publisher.
Save reminder output; missing wording is an unfinished outcome.
No flag or app account is needed for the policy command.

## Cleanup

No app fixtures or production settings change.
Keep sanitized proof outside the worktree.
