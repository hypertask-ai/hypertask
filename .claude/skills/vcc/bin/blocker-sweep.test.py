#!/usr/bin/env python3
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("blocker-sweep.py")
QUESTION = {
    "id": 42,
    "text": "<p>Question: <strong>Keep it?</strong></p><p>My recommendation: Yes.</p><p>Why: less work.</p><p>Yes: keep it.</p><p>No: remove it.</p>",
    "createdAt": "2026-10-29T00:00:00Z",
    "reactions": [{"userId": 6, "emoji": "👍", "createdAt": "2026-10-29T00:01:00Z"}],
}


class SweepTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.state = self.root / "state.json"
        self.trace = self.root / "trace.jsonl"
        self.write_state()
        vcc = self.root / "vcc"
        vcc.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
state = pathlib.Path(os.environ["FIXTURE_STATE"])
data = json.loads(state.read_text())
with open(os.environ["FIXTURE_TRACE"], "a") as trace:
    trace.write(json.dumps(args) + "\\n")
if args[:2] == ["task", "get"]:
    print(json.dumps({"success":True,"tasks":[data["task"]]}))
elif args[:2] == ["comments", "list"]:
    offset = int(args[args.index("--offset") + 1])
    comments = data["comments"][offset:offset+100]
    print(json.dumps({"success":True,"comments":comments}))
elif args[:2] == ["task", "waiting-on"]:
    assert args[3:5] == ["--user", "none"]
    data["task"]["blockerCommentId"] = None
    data["task"]["waitingOnUserId"] = None
    state.write_text(json.dumps(data))
elif args[:2] == ["activity", "add"]:
    assert "Valentin approved" in args[3]
else:
    sys.exit(91)
''')
        vcc.chmod(0o755)
        source = self.root / "shared-sweep.py"
        source.write_text('print("ANSWERED\\tYPER4-1\\t123\\tcomment 42\\tQuestion")\n')
        self.env = {
            **os.environ, "VCC_BIN": str(vcc), "VCC_BLOCKER_SOURCE": str(source),
            "FIXTURE_STATE": str(self.state), "FIXTURE_TRACE": str(self.trace),
        }

    def write_state(self, question=None, marked=42, prefix=None):
        self.state.write_text(json.dumps({
            "task": {"id": 123, "blockerCommentId": marked, "waitingOnUserId": 6},
            "comments": (prefix or []) + [copy.deepcopy(QUESTION if question is None else question)],
        }))

    def run_sweep(self, *args):
        return subprocess.run([sys.executable, str(SCRIPT), *args], env=self.env, capture_output=True, text=True)

    def calls(self):
        return [json.loads(line) for line in self.trace.read_text().splitlines()] if self.trace.exists() else []

    def assert_no_writes(self):
        self.assertFalse(any(call[:2] in (["task", "waiting-on"], ["activity", "add"]) for call in self.calls()))

    def test_dry_run_never_changes_blockers(self):
        result = self.run_sweep("sweep", "15")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("APPROVED\tYPER4-1\t42", result.stdout)
        self.assert_no_writes()
        self.assertEqual(json.loads(self.state.read_text())["task"]["blockerCommentId"], 42)

    def test_apply_clears_both_fields_then_logs_once(self):
        result = self.run_sweep("sweep", "15", "--apply")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("CLEARED\tYPER4-1\t42", result.stdout)
        task = json.loads(self.state.read_text())["task"]
        self.assertIsNone(task["blockerCommentId"])
        self.assertIsNone(task["waitingOnUserId"])
        writes = [call[:2] for call in self.calls() if call[:2] in (["task", "waiting-on"], ["activity", "add"])]
        self.assertEqual(writes, [["task", "waiting-on"], ["activity", "add"]])
        retry = self.run_sweep("sweep", "15", "--apply")
        self.assertEqual(retry.returncode, 0, retry.stderr)
        self.assertEqual(sum(call[:2] == ["task", "waiting-on"] for call in self.calls()), 1)

    def test_only_current_human_yes_approval_clears(self):
        variants = [
            {"reactions": []},
            {"text": QUESTION["text"].replace("recommendation: Yes", "recommendation: No")},
            {"editedAt": "2026-10-29T00:02:00Z"},
        ]
        for changes in ({"userId": 7}, {"emoji": "👎"}, {"isAgent": True}, {"agent": {"id": "runner"}}, {"isDeleted": True}, {"createdAt": "2026-10-28T23:59:00Z"}):
            reaction = {**QUESTION["reactions"][0], **changes}
            variants.append({"reactions": [reaction]})
        for changes in variants:
            with self.subTest(changes=changes):
                self.write_state({**copy.deepcopy(QUESTION), **changes})
                result = self.run_sweep("sweep", "15", "--apply")
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertNotIn("CLEARED", result.stdout)
                self.assert_no_writes()

    def test_changed_marker_is_not_cleared(self):
        question = {**copy.deepcopy(QUESTION), "id": 43}
        self.write_state(question, marked=43)
        result = self.run_sweep("sweep", "15", "--apply")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_no_writes()

    def test_old_marked_question_is_found_after_first_page(self):
        self.write_state(prefix=[{"id": i + 1000, "text": "A note."} for i in range(100)])
        result = self.run_sweep("check", "YPER4-1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), QUESTION["text"])
        self.assertTrue(any("100" == call[call.index("--offset") + 1] for call in self.calls() if "--offset" in call))

    def test_marked_status_note_cannot_become_a_wait(self):
        self.write_state({**copy.deepcopy(QUESTION), "text": "<p>Ready to try.</p>"})
        result = self.run_sweep("check", "YPER4-1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not a Question", result.stderr)
        self.assert_no_writes()

    def test_shared_scan_failure_never_writes(self):
        Path(self.env["VCC_BLOCKER_SOURCE"]).write_text("raise RuntimeError('fixture scan failure')\n")
        result = self.run_sweep("sweep", "15", "--apply")
        self.assertNotEqual(result.returncode, 0)
        self.assert_no_writes()


if __name__ == "__main__":
    unittest.main()
