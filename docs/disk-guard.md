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
  user-available. Below 75%, only eligible linked worktrees are considered.
- Thresholds (YPER4-236, https://app.hypertask.ai/detail/project-4060/236):
  from **75%** the guard frees re-creatable caches and stops as soon as the disk
  is below **70%**; from **80%** the `/tmp` and Docker image cleanup below also
  runs; at **90%** the critical hold and alert stay exactly as before. 75% leaves
  room for a few full builds (about 4 GB each) between 15-minute runs before the
  80% line; 70% gives hysteresis so the guard does not run on every tick.
- Cache categories, cheapest to rebuild first. Every path candidate must be
  owned by us, on the same filesystem, free of mounts and special files, and
  must not be a link itself. Links inside a cache (such as `node_modules/.bin`)
  are removed as links and never followed. It must also pass the same process
  scan as below, a command-line scan (no process argument names a path inside
  it), and a running-container bind-mount check. An unreadable command line or
  failed Docker mount listing keeps every candidate. Any `.env*` or
  storageState file inside keeps the candidate. Nothing under `~/.config`,
  `~/.ssh`, `~/.claude`, `~/.codex` or `~/.local/state/vcc-evidence` is ever a
  candidate (YPER4-228). The checks rerun right before each deletion. The
  folder is first renamed into `~/.local/state/disk-guard/trash` so a tool
  starting at that moment sees an empty cache. A later run finishes trash left
  by an interrupted run.
  1. `docker-volumes`: unused (no container, running or stopped) anonymous
     volumes created more than 7 days ago, and leaked
     `ht-smoke-{build,state,dependencies}-*` volumes from
     `scripts/run-app-smoke-isolated.sh` older than 1 day. Removed one by one
     with `docker volume rm`. Named volumes are never removed and nothing is
     pruned with `-a`.
  2. `playwright-old`: `~/.cache/ms-playwright/<browser>-<revision>` older
     than 7 days. The newest revision of each browser is always kept, as is
     any revision named in a `browsers.json` reached from Playwright's own
     `.links` registry, any registered worktree's `node_modules`, or any npx
     package. If no reference can be read, or one is malformed, all stay.
  3. `tool-caches`: `~/.cache/go-build`, `node-gyp`, `zig` and `uv`, with no
     write for 2 days. `puppeteer`, `prisma` and browser profiles are not
     caches the tool rebuilds on its own and are never touched.
  4. `npx-cache`: each `~/.npm/_npx/<hash>` package with no write for 7 days.
     A running npx server keeps its package through the command-line scan.
  5. `next-build`: the `.next` folder of a registered worktree (anywhere,
     including `/tmp`) with no write for 2 days, oldest first. Any process,
     command line or container that uses any part of that worktree keeps it.
     This applies to worktrees with open PRs too, because only the rebuildable
     build folder goes. The worktree itself still follows the worktree rules.
     The `~/projects/hypertask` main checkout is never touched.
  6. `npm-cache`: the whole `~/.npm/_cacache` only when no `npm` or `npx`
     process runs at all and nothing was written to it for one hour.
     Per-file deletion is not used.
- At 80%, old user-owned `/tmp` leftovers and dangling Docker images can be
  cleaned. Every descendant's newest mtime must be older than two days. Links,
  mounts, special files, foreign owners, incomplete scans, active process paths,
  and registered worktrees are kept. Git checkouts are not disposable caches.
- `/tmp/claude-*` top-level directories and scratch/build content stay. Only
  named `node-compile-cache*` and `.next/cache` descendants are eligible, with
  the same age, ownership and process checks. A live process using a cache
  keeps it. No generalized Claude scratchpad deletion is performed.
- Process inspection first tries a read-only sudo scan across all UIDs, including
  root: `sudo -n /usr/bin/python3 -I -c <fixed embedded script>`, without a shell
  and with a 60-second timeout. The constant script only lists `/proc` entries
  and reads `cwd`, `root`, and `fd` symlink targets, strips ` (deleted)`, and
  returns absolute paths as JSON. Vanished processes/descriptors are skipped;
  other inspection errors fail the scan. No caller data enters the sudo command,
  nothing is written as root, and no privileged helper is installed.
  A successful scan is complete, with no uncertainty. If sudo is unavailable,
  fails, times out, or returns invalid output, the unprivileged scan is used.
  Any unreadable other-UID or root process then keeps every candidate, including
  named caches and `0700` directories, with reason
  `privileged process scan unavailable`. Any process using a candidate keeps it.
  Permission or I/O errors in an own-process scan also keep the candidate, except
  for `sshd`, `(sd-pam)`, `gpg-agent`, `ssh-agent`, and zombies. These harmless
  exceptions apply only to our own UID in the unprivileged fallback. Failed
  process IDs are retried for each later candidate; readable paths are cached.
  Every deletion refreshes the full scan.
- Worktree discovery covers repositories under `~/projects`, including nested
  worker-tree parents. Dependency/build directories are not traversed for repo
  discovery. The `~/projects/hypertask` checkout is never used as a command cwd
  or considered for removal. A failed discovery protects only that repository
  folder, not unrelated temporary output. Successful discoveries still protect
  all their registered worktrees. Each temporary candidate is also kept if it
  or any descendant at any depth contains a `.git` file or directory. This full
  walk never follows symlinks, and any inspection error keeps the candidate.
  Failed repository folders appear once in the summary and remain report-only.
- Linked worktrees must be clean, including untracked files, inactive, and older
  than three days. Age excludes `.git` and `node_modules`. Locked worktrees stay.
  GitHub must confirm no open PR for a named branch, and either its current tip
  matches a merged PR or is an ancestor of `origin/HEAD`. Detached worktrees
  always stay with reason `detached worktree; open PR cannot be ruled out`.
  A branch without a surviving upstream must have HEAD contained in a remote ref.
  Missing default refs and failed, malformed, truncated or rate-limited `gh`
  responses keep the worktree. Remote refs are not fetched or changed by the
  guard. Calls are cached per run and capped at 60 per sweep.
- Ignored worktree paths are checked initially and again before removal.
  Anything outside the disposable allowlist keeps the worktree with reason
  `ignored local files present`, including ignored `.env*` files and local notes.
  The allowlist is `node_modules`, `.next`, `dist`, `build`, `out`, `coverage`,
  `.turbo`, `.cache`, `.vercel/output`, `target`, `zig-cache`, `.zig-cache`,
  `zig-out`, `__pycache__`, `.pytest_cache`, `*.tsbuildinfo`, and `.eslintcache`.
- Worktrees use `git worktree remove`, never force. Only proven merged branches
  are passed to `git branch -d`. Git may keep a squash-merged branch if safe
  branch deletion is refused. Detached/abandoned branch names are retained.
- At 90%, a fresh `critical` file holds new local heavy jobs. The heavy-job
  wrapper also checks `df` on `/` and refuses at 90% even if the flag is missing
  or stale. Waiting jobs recheck before starting. The flag expires after 30
  minutes if the timer stops, but critical disk usage still holds jobs. The
  existing `CI=true` / `GITHUB_ACTIONS` bypass skips both checks. A run below
  90% removes the flag.
- Critical notifications reuse the fleet-watchdog Telegram route, addressed to
  INFRA MANAGER, using the two `TELEGRAM_HYPERTASK_*` variables in
  `~/.config/hypertask-env.sh` or the environment. Attempts are limited to one
  per hour. Credentials and notification errors are never printed or logged.
- Named Docker volumes are never removed, even when dangling; only the volume
  rules in cache category 1 apply. Images are pruned without `-a`, so only
  dangling images are eligible.

## State and report

`~/.local/state/disk-guard/log` and the service journal contain only removals,
errors, and one summary per run by default. The summary includes counts per
keep reason, failed repository folders, and bytes freed. Per-item keeps are
printed and logged only with `--verbose`; the default never writes those
expanded details to disk. The log rotates before reaching 5 MiB, retaining only
`log.1`. `status.json` records `used_percent`, `level` (`ok`, `clean`, `critical`),
`last_run`, `freed`, removal/keep counts, `keep_reasons`, `failed_repos`,
`thresholds`, and `caches`: per category `freed` and `would_free` bytes and the
number of `paths`. The same object is in the journal summary line, and each
cache removal line names its category.
Critical flag, alert marker, status, and log write errors never abort cleanup,
including `ENOSPC`. If the log cannot be written, its line and a generic warning
are sent to stderr. Alerts are not sent when their rate-limit marker cannot be
saved.
`--dry-run` only prints decisions, never changes state, deletes data, sends
notifications, or prunes Docker. It previews every cache category at any disk
usage and does not stop at the 70% target. Its `would_free` is an
allocated-size estimate (Docker volume sizes come from `docker system df`),
not a Docker image estimate. Actual worktree/image freed bytes are observed
filesystem usage deltas and may reflect concurrent host activity.

`--report` writes `report-YYYY-MM-DD.md` without deleting anything. Orphan
worktrees whose gitdir is missing are listed as "orphan worktree folder, main repo
missing", with allocated size and newest mtime, always keep. Other discovery
failures are listed with their inspection failure reason. It also lists
sizes, newest ages and keep/delete recommendations for VCC evidence, br7 runs,
retired-agent archives and npm caches, plus old `_cacache` file counts,
Docker volume usage, and a per-category table of what the cache rules would
free right now. Evidence is retained as audit proof. Archive paths include
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
