# Acceptance coverage and independent proof

## How to drive it

Read the installed `ship-check` and `proof-coverage.py` hashes against their
production sources. Read the merged PR's GitHub-hosted `ship-scripts-tests`
logs, including the historical HTPR-7766 fixture and complete-proof control.
Never run that fixture suite on the VPS.

For live QA, copy each Done-when or Acceptance bullet and each
What usually breaks or Gotchas bullet into proof.md. A missing bullet is
refused by name. PASS and TRIED need a nonempty file in the run folder.
NOT-APPLICABLE needs a reason. The builder runs `ship-check bind`. A
different runner inspects the committed drive script, then runs
`ship-check rerun TICKET SCRIPT FRESH-QA-RUN`. The script's only argument
is the new output directory. Exit zero records PASS. Then
`ship-check proof TICKET` must print `proof ok`. Set `SHIP_PROOF_STRICT=0`
only to keep the older shape checks.

```text
Feature map: .claude/skills/verify-qa/reference/feature-map/<page>.md
Doctor: sha <merge-sha> deployment success; /my-tasks signed in as user <id>
Run: <YYYY-MM-DD>-qa-run-<n>
Drive script: <repository-relative .mjs, .py or .sh committed in the merge>
Acceptance: PASS: <exact acceptance bullet> -> <nonempty-file>
Breakage: TRIED: <exact breakage bullet> -> <nonempty-file>
Breakage: NOT-APPLICABLE: <exact breakage bullet> -> <reason of 10 characters or more>
Cases: PASS: <case> -> <nonempty-file>
```

## What usually breaks

- One acceptance bullet is omitted despite passing Cases.
- A passing item points to missing or empty evidence.
- A feature-page breakage bullet is missing or has no applicability reason.
- The builder records their own rerun or reuses the builder's output folder.
- A proof, drive script or rerun output changes after independent QA.
- The installed merge guard lacks the coverage helper.

## Proof

Keep the hosted regression job link, installed hashes and actual live
proof-check output. A different runner records this ticket's final verdict.

## Cleanup

Remove only disposable evidence from your own QA run. Strict-mode rollback
uses `SHIP_PROOF_STRICT=0`; existing structure checks remain enabled.
