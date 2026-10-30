## Production revert proposals

`production-revert-pr.yml` handles failed production CI runs. It opens a revert PR, never merges or pushes production. Existing live-health rollback stays unchanged.

The read-only job replays named failing Node tests twice inside network-disabled containers. A locally built scratch image mounts system binaries, dependencies, and Git objects read-only. Runner control files, credentials, and the Docker socket stay outside. The last green production commit must pass. Git history identifies the first failing commit, whose parent must pass. The same checks must pass twice after reverting only that commit on current production. Later merges remain intact. Rate-limit, network, timeout, inconsistent, unsupported setup, dependency-lock changes, and already-fixed failures produce no proposal. The history search stops at 50 commits.

The separate publisher executes no candidate code. It rechecks production, pushes one deterministic branch per culprit, and leaves auto-merge off. The existing `AUTOMERGE_TOKEN` lets the proposal trigger normal required checks. No new credential or runner is needed.

Relevant PRs also replay the recorded incident without publishing. Manual dispatch accepts a failed CI run ID. It replays that historical head without opening a PR. For the 25 October source-regex incident, use run `40201291546`: the expected culprit is `73cc4b70870fb411935a3a169779a8fb8b49f168` (PR #2129). Hosted fixtures also prove publication against a disposable local Git remote, not production.
