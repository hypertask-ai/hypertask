#!/usr/bin/env python3
"""Review bounded source scopes and retain completed batches across retries."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import time

SCRIPTS = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("report_check", SCRIPTS / "strix-check-run.py")
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def plan(source, paths, max_files=12, max_bytes=60000):
    batches, current, size = [], [], 0
    for name in sorted(set(paths)):
        candidate = source / name
        if not candidate.is_file() or candidate.is_symlink():
            continue
        candidate.resolve().relative_to(source.resolve())
        length = candidate.stat().st_size
        if current and (len(current) >= max_files or size + length > max_bytes):
            batches.append(current)
            current, size = [], 0
        current.append(name)
        size += length
    if current:
        batches.append(current)
    return batches


def run(source, paths, state, output, revision, base, budget, batch_budget, max_files):
    if batch_budget <= 0 or budget < batch_budget or max_files < 1:
        raise ValueError("budget must cover one positive batch budget; max-files must be positive")
    batches = plan(source, paths, max_files)
    scope_key = hashlib.sha256(json.dumps([revision, base, batches]).encode()).hexdigest()[:24]
    checkpoint = state / scope_key
    manifest = {"revision": revision, "base": base, "status": "running", "batches": [],
                "scope_files": sum(len(b) for b in batches), "reserved_budget": 0}
    write_json(output / "coverage.json", manifest)
    failed = False
    for index, files in enumerate(batches):
        receipt = checkpoint / f"{index}.json"
        entry = {"index": index, "files": files, "status": "pending"}
        manifest["batches"].append(entry)
        if receipt.exists():
            previous = json.loads(receipt.read_text())
            # A checkpoint only counts while its original report still validates.
            try:
                checker.validate(Path(previous["run"]).parent)
                entry.update(previous)
                continue
            except (ValueError, OSError, KeyError):
                receipt.unlink()
        if failed or manifest["reserved_budget"] + batch_budget > budget:
            continue
        manifest["reserved_budget"] += batch_budget
        attempt = output / f"batch-{index:04d}"
        attempt.mkdir(parents=True)
        instruction = attempt / "instructions.txt"
        instruction.write_text(
            "Authorized source-only security review. Use one reviewer beneath the required coordinator. "
            "Do not fan out further. Aim to finish inspection in ten tool calls, then report. "
            "Review ONLY the files listed below, reading their callers and tests as needed. "
            "The full read-only repository is context, not additional review scope. "
            "Inspect authentication, authorization, input handling and secret exposure where relevant. "
            "Use small local reproductions with mocks. Never access live URLs, remote services, "
            "host credentials or files outside the mounted source. Do not modify source or file tickets. "
            "Do not run repository-wide scanners. Findings need a reachable attack path and file:line evidence. "
            "Record each finding with create_vulnerability_report before finish_scan; do not leave findings only in prose. "
            "Finish with COVERAGE_COMPLETE only after reviewing every listed file. "
            "Otherwise write COVERAGE_INCOMPLETE and name the remaining files. "
            "The report covers this batch only, not the whole application.\n\n"
            + "\n".join(files) + "\n"
        )
        command = ["strix", "-n", "-m", os.environ.get("STRIX_SCAN_MODE", "quick"),
                   "--scope-mode", "full", "--mount", str(source),
                   "--max-budget-usd", str(batch_budget), "--instruction-file", str(instruction)]
        entry["started_at"] = time.time()
        write_json(output / "coverage.json", manifest)
        try:
            with (attempt / "scan.log").open("w") as log:
                result = subprocess.run(command, cwd=attempt, stdout=log, stderr=subprocess.STDOUT,
                                        timeout=int(os.environ.get("STRIX_BATCH_TIMEOUT", "600")))
            if result.returncode not in (0, 2):
                raise ValueError(f"Strix exited {result.returncode}")
            report = checker.validate(attempt / "strix_runs")
            entry["run"] = str(report)
            env = {**os.environ, "STRIX_APP": str(source),
                   "STRIX_FILED_STATE": str(state.parent / "filed-titles.json")}
            subprocess.run(["python3", str(SCRIPTS / "strix-file-tickets.py"), str(report)],
                           env=env, check=True, timeout=720)
            entry["status"] = "completed"
            write_json(receipt, entry)
        except (ValueError, OSError, subprocess.SubprocessError) as error:
            entry.update(status="failed", error=str(error))
            failed = True
        write_json(output / "coverage.json", manifest)
    done = sum(b["status"] == "completed" for b in manifest["batches"])
    manifest.update(completed_batches=done, total_batches=len(batches),
                    status="completed" if done == len(batches) else "failed" if failed else "pending")
    write_json(output / "coverage.json", manifest)
    print(f"Strix coverage: {done}/{len(batches)} batches completed; {manifest['status']}")
    return 0 if manifest["status"] == "completed" else 1 if failed else 3


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("source", "files", "state", "output"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    for name in ("revision", "base"):
        parser.add_argument(f"--{name}", required=True)
    parser.add_argument("--budget", type=float, default=30)
    parser.add_argument("--batch-budget", type=float, default=6)
    parser.add_argument("--max-files", type=int, default=6)
    args = parser.parse_args()
    if args.batch_budget <= 0 or args.budget < args.batch_budget or args.max_files < 1:
        parser.error("budget must cover one positive batch budget; max-files must be positive")
    raise SystemExit(run(args.source.resolve(), args.files.read_text().splitlines(), args.state.resolve(),
                         args.output.resolve(), args.revision, args.base,
                         args.budget, args.batch_budget, args.max_files))
