#!/usr/bin/env python3
"""Run the defined app security baseline against clean app and CLI snapshots."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

SCRIPTS = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("batches", SCRIPTS / "strix-review-batches.py")
batches = importlib.util.module_from_spec(spec)
spec.loader.exec_module(batches)


def snapshot(state, output, name, remote, ref):
    mirror = state / f"{name}.git"
    if not mirror.exists():
        subprocess.run(["git", "init", "--bare", str(mirror)], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(["git", "-C", str(mirror), "fetch", remote, ref], check=True)
    revision = subprocess.check_output(["git", "-C", str(mirror), "rev-parse", "FETCH_HEAD"], text=True).strip()
    source = output / name
    source.mkdir()
    with tempfile.TemporaryFile() as archive:
        subprocess.run(["git", "-C", str(mirror), "archive", revision], stdout=archive, check=True)
        archive.seek(0)
        subprocess.run(["tar", "-x", "-C", str(source)], stdin=archive, check=True)
    return source, revision


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", default="all")
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--live-only", action="store_true")
    modes.add_argument("--source-only", action="store_true")
    args = parser.parse_args()
    profiles = json.loads((SCRIPTS / "strix-assessment.json").read_text())
    if args.profile != "all":
        if args.profile not in profiles:
            parser.error("unknown profile; choose " + ", ".join(profiles))
        profiles = {args.profile: profiles[args.profile]}
    state = Path(os.environ.get("STRIX_ASSESSMENT_STATE", "~/.local/state/strix/assessment")).expanduser().resolve()
    state.mkdir(parents=True, exist_ok=True)
    output = Path(tempfile.mkdtemp(prefix=time.strftime("run-%Y%m%dT%H%M%S-", time.gmtime()), dir=state))
    manifest = {"scope": "defined security baseline, not a full application audit", "status": "running",
                "output": str(output), "profiles": {}, "live": "not_requested",
                "runner_id": os.environ.get("STRIX_RUNNER_ID")}
    def save():
        batches.write_json(output / "assessment.json", manifest)
        batches.write_json(state / "latest.json", manifest)
    save()
    try:
        if not args.source_only:
            result = subprocess.run(["node", str(SCRIPTS / "strix-live-check.mjs"), str(output / "live")], timeout=300)
            live = json.loads((output / "live/live-results.json").read_text())
            manifest["live"] = "passed" if result.returncode == 0 else "findings" if result.returncode == 2 and live["completed"] else "blocked"
            save()
        if not args.live_only:
            snapshots = {}
            for name, remote, ref in [("app", "https://github.com/hypertask-ai/hypertask.git", "production"),
                                      ("cli", "https://github.com/hypertask-ai/cli.git", "main")]:
                snapshots[name] = snapshot(state, output, name, remote, ref)
            for name, profile in profiles.items():
                source, revision = snapshots[profile["repository"]]
                missing = [p for p in profile["files"] if not (source / p).is_file()]
                if missing:
                    manifest["profiles"][name] = {"status": "blocked", "missing": missing}
                    save()
                    continue
                result = batches.run(source, profile["files"], state / "batches", output / name,
                                     revision, name, float(os.environ.get("STRIX_PROFILE_BUDGET", "6")),
                                     float(os.environ.get("STRIX_BATCH_BUDGET", "6")), 6)
                manifest["profiles"][name] = {"status": "completed" if result == 0 else "incomplete",
                                              "revision": revision, "files": profile["files"]}
                save()
        manifest["status"] = "completed" if manifest["live"] != "blocked" and all(
            p["status"] == "completed" for p in manifest["profiles"].values()) else "incomplete"
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        manifest.update(status="failed", error=str(error))
    finally:
        save()
        print(json.dumps(manifest, indent=2))
    if manifest["status"] != "completed":
        return 1
    return 2 if manifest["live"] == "findings" else 0


if __name__ == "__main__":
    os.umask(0o077)
    raise SystemExit(main())
