import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("pr-merge-pass")
REPO = "hypertask-ai/hypertask"
SHA = "a" * 40
OTHER_SHA = "b" * 40
APP = "hypertask-runners[bot]"

STUB = """#!/usr/bin/env python3
import json, os, re, sys
from pathlib import Path
home = Path(os.environ["HOME"])
args = sys.argv[1:]
with open(home / "gh.log", "a") as log:
    log.write(" ".join(args) + "\\n")
def emit(value):
    print(json.dumps(value))
    sys.exit(0)
def fixture(name, default):
    path = home / name
    return json.loads(path.read_text()) if path.exists() else default
if args[:2] == ["pr", "view"]:
    path = home / ("view-" + args[2] + ".json")
    if not path.exists():
        print("no such pull request", file=sys.stderr)
        sys.exit(1)
    emit(json.loads(path.read_text()))
if args[:2] == ["pr", "list"]:
    emit(fixture("list.json", []))
if args[:1] == ["api"]:
    match = re.search(r"commits/([0-9a-f]{40})/statuses", args[1])
    emit(fixture("statuses-" + (match.group(1) if match else "") + ".json", []))
if args[:2] == ["pr", "merge"]:
    if os.environ.get("MERGE_FAIL"):
        print("GraphQL: Pull request is not mergeable", file=sys.stderr)
        sys.exit(1)
    path = home / ("view-" + args[2] + ".json")
    data = json.loads(path.read_text())
    data["state"] = "MERGED"
    path.write_text(json.dumps(data))
    sys.exit(0)
print("unexpected gh call", file=sys.stderr)
sys.exit(9)
"""


class MergePassTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        (self.home / "bin").mkdir()
        stub = self.home / "bin" / "gh"
        stub.write_text(STUB)
        stub.chmod(0o755)
        self.env = dict(os.environ, HOME=str(self.home), PATH=f"{self.home / 'bin'}:/usr/bin:/bin")
        self.env.pop("SHIP_REPO", None)
        self.env.pop("MERGE_FAIL", None)

    def write(self, name, value):
        (self.home / name).write_text(value if isinstance(value, str) else json.dumps(value))

    def pr(self, number, *, state="OPEN", draft=False, head=SHA, merge_state="CLEAN"):
        self.write(f"view-{number}.json", dict(
            number=number, state=state, isDraft=draft, headRefOid=head,
            mergeStateStatus=merge_state, url=f"https://github.com/{REPO}/pull/{number}"))

    def statuses(self, statuses, sha=SHA):
        self.write(f"statuses-{sha}.json", statuses)

    def success(self, login=APP, state="success", sha=SHA):
        self.statuses([dict(context="pstack-verifier", state=state, creator={"login": login})], sha)

    def run_pass(self, *args, queue=None):
        command = [str(SCRIPT), *args]
        if queue is not None:
            self.queue = self.home / "queue.txt"
            self.queue.write_text(queue)
            command += ["--queue", str(self.queue)]
        result = subprocess.run(command, capture_output=True, text=True, env=self.env)
        payload = json.loads(result.stdout) if result.stdout.strip() else {}
        return result, payload

    def gh_calls(self):
        log = self.home / "gh.log"
        return [line.split() for line in log.read_text().splitlines()] if log.exists() else []

    def merges(self):
        return [call for call in self.gh_calls() if call[:2] == ["pr", "merge"]]

    def test_merges_when_the_verifier_app_passed_and_prints_json(self):
        self.pr(123)
        self.success()
        result, payload = self.run_pass("--pr", "123")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(payload["results"][0]["action"], "merged")
        self.assertEqual(payload["counts"], {"merged": 1})
        self.assertEqual(self.merges(), [["pr", "merge", "123", "--repo", REPO, "--merge",
                                          "--match-head-commit", SHA]])
        self.assertFalse(any("--admin" in call or "--auto" in call for call in self.merges()))

    def test_refuses_a_success_from_another_app(self):
        self.pr(123)
        self.success(login="github-actions[bot]")
        result, payload = self.run_pass("--pr", "123")
        self.assertEqual(payload["results"][0]["action"], "skipped")
        self.assertEqual(payload["results"][0]["verifier"], "missing")
        self.assertEqual(self.merges(), [])

    def test_a_later_status_does_not_stand_in_for_the_app(self):
        self.pr(123)
        self.statuses([
            dict(context="pstack-verifier", state="failure", creator={"login": APP}),
            dict(context="pstack-verifier", state="success", creator={"login": "someone"}),
        ])
        result, payload = self.run_pass("--pr", "123")
        self.assertEqual(payload["results"][0]["reason"].startswith("verifier failure"), True)
        self.assertEqual(self.merges(), [])

    def test_pending_and_missing_verifier_never_merge(self):
        self.pr(1)
        self.pr(2, head=OTHER_SHA)
        self.statuses([dict(context="pstack-verifier", state="pending", creator={"login": APP})], SHA)
        self.statuses([], OTHER_SHA)
        result, payload = self.run_pass("--pr", "1", "--pr", "2")
        self.assertEqual([item["action"] for item in payload["results"]], ["skipped", "skipped"])
        self.assertEqual([item["verifier"] for item in payload["results"]], ["pending", "missing"])
        self.assertEqual(self.merges(), [])

    def test_an_unreadable_status_fails_closed(self):
        self.pr(123)
        result, payload = self.run_pass("--pr", "123")
        self.assertEqual(payload["results"][0]["verifier"], "missing")
        self.assertEqual(self.merges(), [])

    def test_queue_drops_merged_and_closed_numbers_and_keeps_the_rest(self):
        self.pr(1)
        self.pr(2, state="MERGED")
        self.pr(3, state="CLOSED")
        self.pr(4, head=OTHER_SHA)
        self.success()
        self.statuses([], OTHER_SHA)
        result, payload = self.run_pass(queue="# keep me\n1\n2\n3\n4\n")
        self.assertEqual(payload["counts"], {"merged": 1, "already-merged": 1, "closed": 1, "skipped": 1})
        self.assertEqual(self.queue.read_text(), "# keep me\n4\n")

    def test_a_refused_merge_reports_and_keeps_the_queue_line(self):
        self.pr(123)
        self.success()
        self.env["MERGE_FAIL"] = "1"
        result, payload = self.run_pass(queue="123\n")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(payload["results"][0]["action"], "refused")
        self.assertEqual(payload["results"][0]["reason"], "GraphQL: Pull request is not mergeable")
        self.assertEqual(self.queue.read_text(), "123\n")

    def test_label_mode_finds_open_prs(self):
        self.pr(7)
        self.success()
        self.write("list.json", [dict(number=7)])
        result, payload = self.run_pass("--label", "merge-queue")
        self.assertEqual(payload["counts"], {"merged": 1})
        self.assertIn(["pr", "list", "--repo", REPO, "--label", "merge-queue", "--state", "open",
                       "--limit", "50", "--json", "number"], self.gh_calls())

    def test_drafts_behind_and_dirty_prs_are_skipped_with_a_reason(self):
        self.pr(1, draft=True)
        self.pr(2, merge_state="BEHIND")
        self.pr(3, merge_state="DIRTY")
        self.success()
        self.success()
        result, payload = self.run_pass("--pr", "1", "--pr", "2", "--pr", "3")
        self.assertEqual([item["reason"] for item in payload["results"]][0], "draft")
        self.assertIn("ship-check fresh 2", payload["results"][1]["reason"])
        self.assertEqual(payload["results"][2]["reason"], "conflicts with the base")
        self.assertEqual(self.merges(), [])

    def test_dry_run_reports_would_merge_and_touches_nothing(self):
        self.pr(123)
        self.success()
        result, payload = self.run_pass("--pr", "123", "--dry-run", queue="123\n")
        self.assertEqual(payload["results"][0]["action"], "would-merge")
        self.assertEqual(payload["dry_run"], True)
        self.assertEqual(self.merges(), [])
        self.assertEqual(self.queue.read_text(), "123\n")

    def test_bad_input_prints_json_and_exits_two(self):
        result, payload = self.run_pass()
        self.assertEqual(result.returncode, 2)
        self.assertIn("--queue", payload["error"])

    def test_repository_defaults_to_ship_repo(self):
        self.pr(123)
        self.success()
        self.env["SHIP_REPO"] = "valentinyeo/other"
        self.write("statuses-" + SHA + ".json", [dict(context="pstack-verifier", state="success",
                                                      creator={"login": APP})])
        result, payload = self.run_pass("--pr", "123")
        self.assertEqual(payload["repo"], "valentinyeo/other")
        self.assertEqual(self.merges()[0][4], "valentinyeo/other")


if __name__ == "__main__":
    unittest.main()
