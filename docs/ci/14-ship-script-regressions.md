## Ship script regressions

The non-required `ship-scripts-tests` check in [`.github/workflows/ship-scripts-tests.yml`](../.github/workflows/ship-scripts-tests.yml) runs on GitHub-hosted `ubuntu-latest` for pull requests to `production` changing the script/unit paths in `docs/ci-policy.yml`, including `.claude/skills/ship/scripts/**`, `.claude/skills/verify-qa/scripts/**`, `scripts/premerge-local.sh` or the workflow itself. It does not change the ruleset or auto-merge requirements. No tests run on the VPS.

- Runs `bash .claude/skills/ship/scripts/ship-check.test.sh --premerge-only`, `python3 .claude/skills/ship/scripts/premerge-evidence.test.py`, `python3 .claude/skills/ship/scripts/ci-why.test.py`, `bash .claude/skills/ship/scripts/board-check.test.sh`, `bash .claude/skills/ship/scripts/user-unit-check.test.sh`, `python3 .claude/skills/verify-qa/scripts/evidence-prune.test.py` and `node --test .claude/skills/verify-qa/scripts/qa-identity.test.mjs`. The full shell suite also contains live authenticated checks and is deliberately excluded.
- Runs `python3 .claude/skills/ship/scripts/ht-hax-runner.test.py` against isolated home folders and fake process/load tools. It checks load-only launches, pauses, active sessions, target bounds, setup failure and validation before enabling the keeper timer. Interactive lifecycle fixtures check brief delivery, final-line detection, saved output, idle cooldown, failed-start watcher cleanup and bounded timeout recovery; they start no real runners.
- Installs Python 3 for the standard-library test harnesses and fixtures, `jq` for JSON handling in `ship-check`, and Git for repository-scope detection. Sets up Node 24 for the dependency-free QA identity tests, which use only temporary storage-state fixtures and a loopback HTTP server (YPER4-607). No npm or pip packages are needed; Bash and standard Unix utilities come with the hosted runner.
- Uses a temporary HOME and the harnesses' temporary state and local Git/GitHub/Hypertask fixtures. A fallback `gh` stub fails unexpected calls outside the fixtures. Tests need no network, real tokens, existing VPS state or systemd service; checkout and dependency installation still use network. Checkout does not persist credentials, and the job requests only `contents: read`, so fork PRs need no secrets.

The evidence-prune fixture test uses a temporary HOME, stubbed read-only
Hypertask responses and stubbed systemctl/unit-check calls. It exercises old and
fresh build trees, retained reports, Done-only video expiry, symlink/filesystem
boundaries, permission errors, daily installer ordering, logging, and premerge
scratch-copy/EXIT cleanup without installing dependencies or building the app.
It runs directly with Python's standard library, not the repository suite.
Daily live cleanup is separately installed by the runner; see
[QA evidence storage](../.claude/skills/verify-qa/reference/evidence-storage.md).
