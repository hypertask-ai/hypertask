# Acceptance coverage and independent proof

Compare installed hashes with production. Read hosted fixture logs; never run fixtures on the VPS.
A different runner inspects the merged script, then runs `ship-check rerun TICKET SCRIPT FRESH-QA-RUN` and `ship-check proof TICKET`.
Copy acceptance items from both the description and structured acceptance criteria, plus every breakage bullet below. English, German, French, Spanish and Dutch acceptance headings are recognized. `SHIP_PROOF_STRICT=0` restores shape-only checks.
Reruns require a clean checkout and execute in a temporary worktree at the target merge, reusing the prepared checkout's installed `node_modules` when present. Newer production commits do not change the drive source. Agent metadata comes from `hypertask task agent-log`; a builder binding outside its latest 100 entries must be renewed before independent QA.

```text
Feature map: .claude/skills/verify-qa/reference/feature-map/<page>.md
Doctor: sha <merge-sha> deployment success; /my-tasks signed in as user <id>
Run: <YYYY-MM-DD>-qa-run-<n>
Drive script: <repository-relative .mjs, .py or .sh committed in the merge>
## Cases
- PASS: <case> -> <nonempty-file>
## Acceptance
- PASS: <exact acceptance bullet> -> <nonempty-file>
## What usually breaks
- TRIED: <exact breakage bullet> -> <nonempty-file>
- NOT-APPLICABLE: <another exact breakage bullet> -> <reason of 10 characters or more>
```

## What usually breaks

- One acceptance bullet is omitted despite passing Cases.
- A passing item points to missing or empty evidence.
- A feature-page breakage bullet is missing or has no applicability reason.
- The builder records their own rerun or reuses the builder's output folder.
- A proof, drive script or rerun output changes after independent QA.
- The installed merge guard lacks the coverage helper.
