# Acceptance coverage and independent proof

## How to drive it

Read the installed `ship-check` and `proof-coverage.py` hashes against their
production sources. Read the merged PR's GitHub-hosted `ship-scripts-tests`
logs, including the historical HTPR-7766 fixture and complete-proof control.
Never run that fixture suite on the VPS.

For live QA, read a real ticket's acceptance bullets and its merged feature
page. Keep each bullet verbatim in proof.md, with a result and evidence.
The builder uses `ship-check bind`; another runner inspects the committed
drive script and runs `ship-check rerun TICKET SCRIPT FRESH-QA-RUN`.
Read back its agent activity, including agent/run IDs, merge and hashes.
`ship-check proof TICKET` must then accept only matching complete records.

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
