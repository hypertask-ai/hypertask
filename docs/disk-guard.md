# Agent Kit disk guard

Ticket: https://app.hypertask.ai/detail/project-4060/223

Install from any worktree with Python 3 (stdlib only):

```bash
python3 .claude/skills/ship/scripts/disk-guard.py --dry-run
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
- All process `cwd`, `fd`, and `root` links are scanned. Permission or I/O errors
  make absence unprovable, so candidate deletion is refused. On a host with
  inaccessible processes this deliberately favors keeping data over freeing
  space. No privileged helper is installed.
- Worktree discovery covers repositories under `~/projects`, including nested
  worker-tree parents. Dependency/build directories are not traversed for repo
  discovery. The `~/projects/hypertask` checkout is never used as a command cwd
  or considered for removal.
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

`~/.local/state/disk-guard/log` has one timestamped line per action with a
reason and bytes freed. The log rotates at 10 MiB with one retained copy, so
the guard's own logs cannot grow indefinitely. `status.json` records `used_percent`, `level`
(`ok`, `clean`, `critical`), `last_run`, `freed`, and removal/keep counts.
`--dry-run` only prints decisions, never changes state, deletes data, sends
notifications, or prunes Docker. Its `would_free` is an allocated-size estimate,
not a Docker image estimate. Actual worktree/image freed bytes are observed
filesystem usage deltas and may reflect concurrent host activity.

`--report` writes `report-YYYY-MM-DD.md` without deleting anything. It lists
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
