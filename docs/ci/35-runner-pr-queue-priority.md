## Runner PR queue priority

`ship-scripts-tests` replays `pr-drain-pick.test.py` alongside the hax launcher
fixtures. The picker uses the runner GitHub App token, serializes local PR
claims, and returns `WAIT` for queued work held by active runners. Only `NONE`
permits normal ticket selection. GitHub or claim read failures never mean an
empty queue. The launcher installer ships both the picker and queue-first
instruction. This changes no required checks or release permissions.

See [the live verification recipe](../.claude/skills/verify-qa/reference/ops-map/pr-drain-picker.md).
