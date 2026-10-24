#!/usr/bin/env python3
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[2]
REPO = "repos/hypertask-ai/hypertask"


def command(*args):
    result = subprocess.run(args, cwd=ROOT, capture_output=True, check=True)
    return result.stdout.decode("utf-8", errors="replace")


def api(endpoint, raw=False):
    text = command("gh", "api", f"{REPO}/{endpoint}", "--allow-escape-sequences")
    return text if raw else json.loads(text)


def pages(endpoint, field):
    items = []
    page = 1
    while True:
        response = api(f"{endpoint}&per_page=100&page={page}")
        if response.get("total_count", 0) > 1000:
            raise ValueError("GitHub search cap exceeded; shorten the date interval")
        batch = response[field]
        items.extend(batch)
        if len(batch) < 100:
            if "total_count" in response:
                assert len(items) == response["total_count"], "Incomplete GitHub page set"
            return items
        page += 1


def parse_failures(text):
    failures = []
    for number, raw in enumerate(text.splitlines(), 1):
        line = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", raw)
        if re.search(r"\btest at (?:\S*/)?tests/", line) or re.search(r"\bnot ok \d+ - (?:\S*/)?tests/", line) or re.search(r"✖ (?:\S*/)?tests/", line):
            for match in re.finditer(r"(?:^|[ /'\"])(tests/[\w./-]+\.(?:test|spec)\.(?:cjs|ts|mjs|js))(?::(\d+))?", line):
                entry = {"file": match[1], "sourceLine": int(match[2]) if match[2] else None, "logLine": number}
                if not any(item["file"] == entry["file"] for item in failures):
                    failures.append(entry)
    return failures


def parse_timing(text, catalog):
    names = {}
    files = {row["file"] for row in catalog}
    for row in catalog:
        for item in row["titles"]:
            if not item.get("dynamic"):
                names.setdefault(item["title"], set()).add(row["file"])
    records = []
    unknown_seconds = 0
    unknown_records = 0
    in_test = False
    for number, line in enumerate(text.splitlines(), 1):
        if "##[group]Run npm test" in line or "##[group]Run npm test 2>&1" in line:
            in_test = True
        if not in_test:
            continue
        line = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", line)
        content = re.sub(r"^\S+Z ", "", line)
        match = re.match(r"^[✔✖﹣] (.+) \(([0-9.]+)ms\)(?: #.*)?$", content)
        if not match:
            continue
        title, ms = match.groups()
        seconds = float(ms) / 1000
        matches = {title} if title in files else names.get(title, set())
        if len(matches) == 1:
            records.append({"file": next(iter(matches)), "seconds": seconds, "logLine": number, "kind": "file-result" if title in files else "top-level-callback"})
        else:
            unknown_seconds += seconds
            unknown_records += 1
    return {"records": records, "unattributedSeconds": round(unknown_seconds, 6), "unattributedRecords": unknown_records, "topLevelSeconds": round(unknown_seconds + sum(record["seconds"] for record in records), 6), "topLevelRecords": unknown_records + len(records)}


def self_test():
    assert parse_failures("time success stack at tests/allowed.test.cjs:4\n") == []
    assert parse_failures("time ℹ failing tests:\ntime test at tests/refused.test.cjs:8:1\n")[0]["file"] == "tests/refused.test.cjs"
    assert parse_failures("time not ok 1 - tests/refused.test.ts\n")[0]["file"] == "tests/refused.test.ts"
    assert parse_failures("time ℹ failing tests:\ntime test at tests/refused.test.cjs:8:1\ntime > Isolated Node test: tests/allowed.test.cjs\ntime stack at tests/allowed.test.cjs:4\n") == [{"file": "tests/refused.test.cjs", "sourceLine": 8, "logLine": 2}]
    catalog = [{"file": "tests/a.test.cjs", "titles": [{"title": "works", "suite": False}, {"title": "duplicate", "suite": False}]}, {"file": "tests/b.test.cjs", "titles": [{"title": "duplicate", "suite": False}]}]
    parsed = parse_timing("2026Z ✔ works (999ms)\n2026Z ##[group]Run npm test\n2026Z ✔ works (100ms)\n2026Z   ✔ child (500ms)\n2026Z ✔ duplicate (20ms)\n", catalog)
    assert parsed["records"] == [{"file": "tests/a.test.cjs", "seconds": 0.1, "logLine": 3, "kind": "top-level-callback"}]
    assert parsed["unattributedSeconds"] == 0.02
    print("collector self-test passed")


def main():
    parser = argparse.ArgumentParser(description="Read-only GitHub evidence collection; never executes inventoried tests")
    parser.add_argument("--base", default="origin/production")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--refresh-logs", action="store_true", help="Reparse only captured failing jobs and the pinned timing job")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    target = ROOT / "docs/test-inventory/evidence.json"
    if args.refresh_logs:
        result = json.loads(target.read_text())
        for job in result["ci"]["jobs"]:
            if job["logStatus"] not in ["parsed", "unavailable"]:
                continue
            log = api(f"actions/jobs/{job['id']}/logs", raw=True)
            job.update({"failures": parse_failures(log), "logStatus": "parsed", "logSha256": hashlib.sha256(log.encode()).hexdigest()})
        timing = result["ci"]["timing"]
        catalog = json.loads(command("node", "scripts/test-inventory/inventory.mjs", "--catalog", result["base"]))
        log = api(f"actions/jobs/{timing['jobId']}/logs", raw=True)
        assert hashlib.sha256(log.encode()).hexdigest() == timing["logSha256"], "Pinned timing log changed"
        timing.update(parse_timing(log, catalog))
        target.write_text(json.dumps(result, indent=2) + "\n")
        print("Refreshed captured logs")
        return
    base = command("git", "rev-parse", args.base).strip()
    as_of = command("git", "show", "-s", "--format=%cI", base).strip()
    end = datetime.fromisoformat(as_of).astimezone(timezone.utc)
    start = end - timedelta(days=30)
    fmt = lambda value: value.isoformat().replace("+00:00", "Z")
    runs = {}
    cursor = start
    while cursor < end:
        stop = min(cursor + timedelta(days=7), end)
        query = urlencode({"branch": "production", "event": "push", "status": "completed", "created": f"{fmt(cursor)}..{fmt(stop)}"})
        for run in pages(f"actions/workflows/ci-tests.yml/runs?{query}", "workflow_runs"):
            runs[run["id"]] = {key: run[key] for key in ["id", "head_sha", "created_at", "updated_at", "conclusion", "html_url", "run_attempt"]}
        cursor = stop
    ordered = sorted(runs.values(), key=lambda run: run["id"], reverse=True)
    print(f"Listed {len(ordered)} completed runs", flush=True)
    inspect = [run for run in ordered if run["conclusion"] not in ["cancelled", "skipped", "neutral"]]

    def inspect_run(run):
        jobs = pages(f"actions/runs/{run['id']}/attempts/{run['run_attempt']}/jobs?filter=all", "jobs")
        result = []
        for job in jobs:
            if job["name"] != "ci-tests":
                continue
            steps = [{key: step.get(key) for key in ["name", "conclusion", "started_at", "completed_at"]} for step in job["steps"] if step["name"] in ["Test", "Test full suite"]]
            record = {"id": job["id"], "runId": run["id"], "sha": run["head_sha"], "url": job["html_url"], "conclusion": job["conclusion"], "steps": steps, "failures": [], "logStatus": "not-requested"}
            failed = any(step["conclusion"] == "failure" for step in steps)
            if failed:
                try:
                    log = api(f"actions/jobs/{job['id']}/logs", raw=True)
                except subprocess.CalledProcessError:
                    record["logStatus"] = "unavailable"
                else:
                    record["failures"] = parse_failures(log)
                    record["logStatus"] = "parsed"
                    record["logSha256"] = hashlib.sha256(log.encode()).hexdigest()
            result.append(record)
        return result

    jobs = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        for index, records in enumerate(pool.map(inspect_run, inspect), 1):
            jobs.extend(records)
            if index % 50 == 0:
                print(f"Inspected {index}/{len(inspect)} runs", flush=True)
    assert len(jobs) == len(inspect), "Missing ci-tests job; investigate before reporting"
    timing_job = next(job for job in jobs if job["conclusion"] == "success" and any(step["name"] == "Test full suite" and step["conclusion"] == "success" for step in job["steps"]))
    catalog = json.loads(command("node", "scripts/test-inventory/inventory.mjs", "--catalog", base))
    log = api(f"actions/jobs/{timing_job['id']}/logs", raw=True)
    timings = parse_timing(log, catalog)
    step = next(step for step in timing_job["steps"] if step["name"] == "Test full suite" and step["conclusion"] == "success")
    wall = (datetime.fromisoformat(step["completed_at"].replace("Z", "+00:00")) - datetime.fromisoformat(step["started_at"].replace("Z", "+00:00"))).total_seconds()
    timings.update({"jobId": timing_job["id"], "url": timing_job["url"], "sha": timing_job["sha"], "stepWallSeconds": wall, "logSha256": hashlib.sha256(log.encode()).hexdigest()})
    result = {"schemaVersion": 1, "base": base, "asOf": fmt(end), "ci": {"from": fmt(start), "to": fmt(end), "listingComplete": True, "runs": ordered, "jobs": jobs, "timing": timings}}
    target = ROOT / "docs/test-inventory/evidence.json"
    target.write_text(json.dumps(result, indent=2) + "\n")
    print(f"Wrote {target.relative_to(ROOT)}; {len(jobs)} jobs; {len(timings['records'])} timing records")


if __name__ == "__main__":
    main()
