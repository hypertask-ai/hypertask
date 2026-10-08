# Agent Kit disk guard

Ticket: https://app.hypertask.ai/detail/project-4060/223

Install from any worktree with Python 3 (stdlib only):

```bash
python3 .claude/skills/ship/scripts/disk-guard.py --dry-run --verbose
python3 .claude/skills/ship/scripts/disk-guard.py --report
python3 .claude/skills/ship/scripts/disk-guard.py --install
systemctl --user start disk-guard.service
systemctl --user list-timers disk-guard.timer
journalctl --user -u disk-guard.service -n 30 --no-pager
```

The installer copies the script to `~/.local/state/disk-guard/disk-guard.py`,
so removing the source worktree does not break the timer. It installs user
systemd units with a persistent 15-minute calendar schedule, disables and stops
`host-disk-sweep.timer`, and stops any in-flight old sweep. Old sweep files stay
in place. Reinstall to update the installed copy. No crontab is used.

## Safety policy

- Disk usage uses available space like `df`, without counting reserved blocks as
  user-available. Below 80%, only eligible linked worktrees are considered.
- At 80%, old user-owned `/tmp` leftovers and dangling Docker images can be
  cleaned. Every descendant's newest mtime must be older than two days. Links,
  mounts, special files, foreign owners, incomplete scans, active process paths,
  and registered worktrees are kept. Git checkouts are not disposable caches.
- `/tmp/claude-*` top-level directories and scratch/build content stay. Only
  named `node-compile-cache*` and `.next/cache` descendants are eligible, with
  the same age, ownership and process checks. A live process using a cache
  keeps it. No generalized Claude scratchpad deletion is performed.
- Only this user's uid's process `cwd`, `fd`, and `root` links are scanned.
  Other users cannot access this user's private 0700 temporary directories.
  Permission or I/O errors in an own-process scan keep the candidate being
  checked. Failed process IDs are retried for each later candidate instead of
  caching their error for the whole run; readable paths are cached. Every
  deletion still refreshes the full scan. Persistent own-process errors prevent
  proving inactivity for each affected candidate. No privileged helper is installed.
- Worktree discovery covers repositories under `~/projects`, including nested
  worker-tree parents. Dependency/build directories are not traversed for repo
  discovery. The `~/projects/hypertask` checkout is never used as a command cwd
  or considered for removal. A failed discovery protects only that repository
  folder, not unrelated temporary output. Successful discoveries still protect
  all their registered worktrees. Each temporary candidate is also kept if it
  or any descendant directory through depth four contains a `.git` marker.
  Failed repository folders appear once in the summary and remain report-only.
- Linked worktrees must be clean, including untracked files, inactive, and older
  than three days. Age excludes `.git` and `node_modules`. Locked worktrees stay.
  GitHub must confirm no open PR for a named branch, and either its current tip
  matches a merged PR or is an ancestor of `origin/HEAD`. A detached tree or a
  branch without a surviving upstream must have HEAD contained in a remote ref.
  Missing default refs and failed, malformed, truncated or rate-limited `gh`
  responses keep the worktree. Remote refs are not fetched or changed by the
  guard. Calls are cached per run and capped at 60 per sweep.
- Worktrees use `git worktree remove`, never force. Only proven merged branches
  are passed to `git branch -d`. Git may keep a squash-merged branch if safe
  branch deletion is refused. Detached/abandoned branch names are retained.
- At 90%, a fresh `critical` file holds new local heavy jobs. Waiting jobs also
  recheck before starting. The hold expires after 30 minutes if the timer stops;
  the existing `CI=true` / `GITHUB_ACTIONS` cap bypass also bypasses this hold.
  A run below 90% removes the flag.
- Critical notifications reuse the fleet-watchdog Telegram route, addressed to
  INFRA MANAGER, using the two `TELEGRAM_HYPERTASK_*` variables in
  `~/.config/hypertask-env.sh` or the environment. Attempts are limited to one
  per hour. Credentials and notification errors are never printed or logged.
- Docker volumes are report-only, even when dangling. Images are pruned without
  `-a`, so only dangling images are eligible.

## State and report

`~/.local/state/disk-guard/log` and the service journal contain only removals,
errors, and one summary per run by default. The summary includes counts per
keep reason, failed repository folders, and bytes freed. Per-item keeps are
printed and logged only with `--verbose`; the default never writes those
expanded details to disk. The log rotates before reaching 5 MiB, retaining only
`log.1`. `status.json` records `used_percent`, `level` (`ok`, `clean`, `critical`),
`last_run`, `freed`, removal/keep counts, `keep_reasons`, and `failed_repos`.
`--dry-run` only prints decisions, never changes state, deletes data, sends
notifications, or prunes Docker. Its `would_free` is an allocated-size estimate,
not a Docker image estimate. Actual worktree/image freed bytes are observed
filesystem usage deltas and may reflect concurrent host activity.

`--report` writes `report-YYYY-MM-DD.md` without deleting anything. Orphan
worktrees whose gitdir is missing are listed as "orphan worktree folder, main repo
missing", with allocated size and newest mtime, always keep. Other discovery
failures are listed with their inspection failure reason. It also lists
sizes, newest ages and keep/delete recommendations for VCC evidence, br7 runs,
retired-agent archives and npm caches, plus old `_cacache` file counts and
Docker volume usage. Evidence is retained as audit proof. Archive paths include
`~/.local/share/retired-agents` and `~/.local/state/retired-agents*`. Docker
creation time is not treated as last-used, and dangling does not prove data is
safe to delete. Review the reasons before any future retention change.

## Tests

```bash
python3 .claude/skills/ship/scripts/disk-guard.test.py
node --test tests/*heavy*.test.cjs
npm run lint
node --test tests/ui-patterns.test.cjs
```

Safety tests use temporary fake repositories and mock `gh` through PATH. The
held-open-file test uses a real child process. They do not lower thresholds or
operate on the production host's data.
