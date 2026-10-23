# QA evidence storage

For https://app.hypertask.ai/detail/project-4060/621. Evidence is proof, not a
working app checkout. Keep `proof.md`, checklists, Markdown, JSON, PNGs and HTML
reports outside disposable build directories. Never build or install app
packages on the VPS; GitHub runs verification.

## Disposable builds on an approved host

`scripts/premerge-local.sh` copies current source, including local edits, into
`mktemp -d /tmp/ht-premerge-build.XXXXXX`. Dependencies and `.next` stay there.
Its EXIT trap stops the app and removes scratch on success, failure, INT or
TERM. Logs and small fixture metadata remain in the original checkout's
private `e2e/smoke/.state/premerge-local/`; `down` uses that original checkout.
Copy only sanitized logs, numbers, screenshots and reports into evidence.

For a separate manual baseline/candidate/profile experiment, own scratch in one
shell, not an app copy under `vcc-evidence`:

```bash
(
  set -euo pipefail
  scratch=$(mktemp -d /tmp/ht-qa-build.XXXXXX)
  trap 'rm -rf -- "$scratch"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  # Prepare and build app copies inside "$scratch" on the approved build host.
  # Copy only small, sanitized outputs into the ticket's evidence folder.
)
```

Do not put `.next`, `node_modules`, `build-*`, package stores, browser caches or
Node toolchains in evidence. This applies to fix-slow-page, speed-analyst,
shared speed-check probes, verify-qa and wireframe experiments alike. SIGKILL
cannot run a shell trap; the daily cleanup is a backstop for legacy debris,
not a reason to create new evidence builds.

## Exact deletion rules

`.claude/skills/verify-qa/scripts/evidence-prune` defaults to `--dry-run` and
requires `--apply` to remove anything. It discovers candidates with
`find -P ... -xdev ... -prune`; it does not traverse candidate builds looking
for more candidates, follow directory symlinks or cross filesystems.
Descriptor-relative inspection/deletion refuses paths outside each approved
root and skips symlinked root/ancestor directories.

- Under `~/.local/state/vcc-evidence`, only directories named `.next`,
  `node_modules`, `build-*`, `.pnpm-store`, `node-v[0-9]*`, or the exact subtree
  `.cache/ms-playwright` are eligible. Their newest contained file must be
  strictly older than two days. Empty directories use their own mtime;
  symlink mtimes can conservatively retain a tree. A qualifying build directory
  is disposable in full, including its package JSON and any other contents;
  never store proof inside it. Other directories are searched only for these
  candidates and videos, never deleted wholesale.
- A regular `*.webm` file must be strictly older than 14 days and live under a
  top-level `HTPR-<number>`, `YPER4-<number>` or `HYFA-<number>` folder. The
  read-only `hypertask tasks get <TICKET> --json` must return exactly one task
  with section `Done`. There is at most one read per ticket per run, only for
  tickets with eligible videos. Non-Done, missing CLI, timeout, failed or
  malformed reads keep videos. No board mutations or database access occur.
- Only entries directly inside `~/.local/state/hypertask-dev-*/tmp/` and
  `~/.local/state/hypertask-qa-*/tmp/` are eligible, using the same two-day
  newest-file rule. Symlink entries are skipped. Nothing beside `tmp` is
  removed: `queue.sqlite3*`, `provider-homes`, `cache`, `unlazy`, `evidence` and
  `full-trust-shims` remain untouched.
- Permission errors, filesystem boundaries and detected entry changes are
  listed as skips and do not abort the rest of the run. Symlinks contained
  within a disposable build may be unlinked, but targets are never followed.
  Everything else, including proof/report files outside builds, stays.

`--evidence-root PATH` or `VCC_EVIDENCE_DIR` overrides the evidence root;
`--state-root PATH` overrides the dev/QA state parent for fixtures. Filesystem
root `/` is refused. Defaults do not depend on the current checkout.

Each run prints candidate paths and decimal GB, then prints and appends one
JSON summary to `~/.local/state/evidence-prune/log.jsonl`: UTC time, apply mode,
`df /` used percentage before/after, allocated bytes freed and planned for
`builds`, `videos` and `tmp`, and distinct skipped-path count. Dry-run frees
zero bytes. A user-wide nonblocking lock refuses overlapping runs. Allocated
bytes can differ from the change in `df` because of open files, hardlinks or
other activity.

## Install after merge (runner only)

From the durable production checkout, review the dry-run before installing:

```bash
.claude/skills/verify-qa/scripts/evidence-prune --dry-run
bash .claude/skills/verify-qa/scripts/evidence-prune-install
~/.local/lib/hypertask/evidence-prune/user-unit-check --first-run evidence-prune.service
systemctl --user status evidence-prune.timer
journalctl --user -u evidence-prune.service -n 30 --no-pager
```

Installation copies scripts, the unit checker and units to the durable
`~/.local/lib/hypertask/evidence-prune/` and `~/.config/systemd/user/` locations,
then runs `user-unit-check` before daemon-reload/enable. No ticket worktree is
referenced by a unit. The daily persistent timer has up to 30 minutes of random
delay; its oneshot runs `--apply` with `Nice=19`, `IOSchedulingClass=idle` and
private umask. The runner verifies a first real run before calling installation
complete. This change does not itself install, enable or run live cleanup.

## Build/evidence source audit

Changed sites (line references in the committed version):

| Site | Change |
| --- | --- |
| `scripts/premerge-local.sh:116`, `:131`, `:235` | EXIT cleanup; source copy, npm and Next build in disposable `/tmp` scratch; report the original checkout's commit. Small private logs/metadata stay in the original state folder. |
| `.claude/skills/verify-qa/SKILL.md:24`, `:116` | Manual build scratch lifecycle and storage/installer rules; remove dependency-reuse advice that would bypass scratch. |
| `.claude/skills/fix-slow-page/SKILL.md:25` | Baseline/candidate/profile builds use trapped scratch; copy small outputs only. |
| `.claude/skills/speed-analyst/SKILL.md:26` | Same rule for performance experiments using the shared speed-check pack. |
| `.claude/skills/wireframe/SKILL.md:25` | HTML/PNG evidence only; any separate app build uses scratch. |
| `.claude/skills/clean-up/SKILL.md:22` | Replace “never cleaned” with the narrowly scoped daily retention rules. |

Found and intentionally unchanged:

| Site | Why left |
| --- | --- |
| `.claude/skills/wireframe/scripts/wireframe:59`, `:64`, `:128` | Captures a PNG, optionally uses cached npx Playwright, and copies an HTML base kit; no app build or install into evidence. |
| `.agents/skills/prototype/SKILL.md:45` | Self-contained HTML/CSS/JS prototype, not an app build. |
| `scripts/speed/measure.mjs:1`, `scripts/speed/README.md:9` | Live measurement using existing dependencies/browser, not app builds. Development setup instructions do not target evidence. |
| `scripts/speed/fetch-github-runs.mjs:22`, `:57` | Downloads/decrypts small results in `mkdtemp`, removes them in `finally`; no app build. |
| `.claude/skills/speed-analyst/PLAYBOOK.md:73`, `:99`, `:252`, `:367`, `:401`, `:481` | Historical premerge/live measurement records and small probe/JSON evidence; not executable build instructions. |
| `.claude/skills/ship/SKILL.md:99`, `.claude/skills/vcc/SKILL.md:52` | Store screenshots, video, API output and proof; no build destination. |
| `.claude/skills/verify-visual/SKILL.md:44` | Downloads screenshot diff artifacts only. |
| `.claude/skills/verify-on-phone/scripts/phone-shot.sh:1` | Screenshot-only wrapper; no app builds. |
| `scripts/run-app-smoke-isolated.sh:33`, `:161`, `:310` | Existing `mktemp` scratch, EXIT cleanup and isolated container install/build; not evidence. |
| `scripts/worktree-node-modules.sh:18` | Explicit development worktree dependency-copy helper, not a QA build/evidence writer. |
| `.claude/skills/update-docs/SKILL.md:15`, `.claude/skills/vcc/SKILL.md:44` | Generic build guidance without an evidence destination; no independent build script. VPS prohibition still applies. |
| `scripts/heavy-job.sh:4` | Only gates an existing command and does not choose build/output paths. |
| `.claude/skills/ship/scripts/disk-guard.py:38`, `:831`, `:940`, `:985`, `:1112` | Existing conservative disk inspection/pruning, not a build writer; intentionally preserves QA evidence. This pruner adds a separate allowlist. |
| `scripts/verify-inbox-first-screen-evidence.cjs:9` | Historical evidence assertions, not an app build. |
| `.claude/skills/verify-qa/reference/feature-map/boards-and-views.md:48`, `cli-install.md:20`, `posthog-error-alerts.md:14`, `signup-check.md:10` | Existing small live-check scripts/reports in evidence, not dependency or build creation. |
| `.claude/skills/maintain-verification-skill/scripts/maintain-verification-weekly:105`, `scripts/proc-watchdog.py:114` | A source-only prohibition and process classification respectively, not build commands or evidence writers. |
| `.claude/skills/verify-qa/reference/feature-map/production-build.md:13` | Describes Vercel deploy build diagnostics, not local evidence builds. |
| `~/projects/company-skills/skills/speed-check/measure.md:6`, `tools.md:14` | External shared pack resolves an installed browser/dependencies and suggests an analyzer; no script builds into evidence. Read only here: edits are restricted to this worktree. Local caller skills now require trapped scratch for any manual analyzer experiment. |

The skill/script search found no toolchain installer writing into evidence.
The cleanup toolchain list is deliberately limited to the explicit package
store, browser-cache and versioned Node directory shapes above; unrelated
caches and arbitrary `tmp-*` evidence directories are not deleted.
