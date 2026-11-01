# Source-text test audit

`report.md` and `inventory.json` are generated. The ticket is
[HYCI-22](https://app.hypertask.ai/detail/project-11514/22); the cleanup that consumes them is
[HYCI-2](https://app.hypertask.ai/detail/project-11514/2).

## Regenerate

```bash
node scripts/test-source-audit.mjs            # rewrite report.md and inventory.json
node scripts/test-source-audit.mjs --check     # fail when the committed files are stale
node scripts/test-source-audit.mjs --verify    # fail when a test file or allowlist entry has no row
node scripts/test-source-audit.mjs --check-cost
node scripts/test-source-audit.mjs --check-wiring
node scripts/test-source-audit.mjs --self-test
```

`--check` needs full git history only through the files it reads; nothing in the report depends
on git history, so a shallow clone regenerates the same bytes.

The report counts the tree it runs on, so every [HYCI-2](https://app.hypertask.ai/detail/project-11514/2)
cleanup batch shrinks the rows and both headline totals. Regenerate in the batch PR: `--check` fails
on stale bytes, and it is not a required CI gate because most test edits do not touch the audit.

## Where the seconds come from

`ci-durations.json` is one `ci-tests` production push, per-file child-process wall time. Refresh it
from a finished run, then regenerate:

```bash
gh run download <run-id> -n test-durations -R hypertask-ai/hypertask --dir /tmp/test-durations
python3 - <<'PY'
import glob, json
files = {}
for path in sorted(glob.glob("/tmp/test-durations/**/test-durations.json", recursive=True)):
    for entry in json.load(open(path))["files"]:
        if not str(entry.get("file", "")).startswith("Shared"):
            files[entry["file"]] = round(entry["durationMs"], 1)
print(len(files))
PY
```

Copy the resulting `{file: milliseconds}` map into `ci-durations.json` under `files`, and update
`provenance` with the run id, sha and shard count.

## Rules the report uses

A test block is source-text when the lint's own detector (`scripts/lib/source-text-regex-detector.cjs`)
flags it, so the audit and the lint can never disagree about what counts. The decision ladder and
its evidence are printed in `report.md` and must stay in step with `RULES` in the script.
