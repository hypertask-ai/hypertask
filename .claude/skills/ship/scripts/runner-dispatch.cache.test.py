#!/usr/bin/env python3
"""Local cache fixtures; every external command is checked and no production paths are used."""
import contextlib
import copy
import importlib.machinery
import importlib.util
import io
import json
import multiprocessing
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(os.environ.get("DISPATCH_TEST_SOURCE", Path(__file__).with_name("runner-dispatch")))
loader = importlib.machinery.SourceFileLoader("runner_dispatch_cache", str(SOURCE))
spec = importlib.util.spec_from_loader(loader.name, loader)
m = importlib.util.module_from_spec(spec)
loader.exec_module(m)


def comment(text="note", ident=1):
    return {"id": ident, "text": text, "createdAt": "2026-10-21T10:00:00Z",
            "agent": {"displayName": "RUNNER 1"}, "type": "comment"}


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name)
        self.loop = self.state / "runner-loop"
        self.cache_path = self.loop / "comments-cache.json"
        self.claim_dir = self.state / "runner-queue/claims"
        self.boards = {
            15: [{"ticketNumber": "HTPR-1", "title": "first", "section": "Bugs",
                  "updatedAt": "v1", "commentCount": 1},
                 {"ticketNumber": "HTPR-2", "title": "second", "section": "Todo",
                  "updatedAt": "v1", "commentCount": 0}],
            4060: [{"ticketNumber": "YPER4-1", "title": "third", "section": "Backlog",
                    "updatedAt": "v1", "commentCount": 1}],
        }
        self.comments = {"HTPR-1": [comment()], "HTPR-2": [], "YPER4-1": [comment()]}
        self.rows = []
        self.calls = []
        self.replies = {}
        self.load = 1
        self.now = 1800000000
        self.snap = patch.object(m, "snapshots", side_effect=lambda: copy.deepcopy(self.rows)).start()
        patch.object(m, "command", side_effect=self.command).start()
        patch.object(m.os, "getloadavg", side_effect=lambda: (self.load, 1, 1)).start()
        patch.object(m.time, "time", side_effect=lambda: self.now).start()
        patch.object(m.time, "sleep").start()
        self.addCleanup(patch.stopall)

    def command(self, *args):
        self.calls.append(args)
        if args[0:3] == ("hypertask", "tasks", "list"):
            self.assertEqual(args[:4], ("hypertask", "tasks", "list", "--project"))
            self.assertEqual(args[5:8], ("--limit", "500", "--json"))
            project = int(args[4])
            self.assertIn(project, self.boards)
            cursor = args[9] if len(args) == 10 and args[8] == "--cursor" else None
            self.assertTrue(len(args) == 8 or cursor is not None)
            override = self.replies.get(("tasks", project, cursor))
            data = override if override is not None else {
                "success": True, "tasks": self.boards[project], "total": len(self.boards[project])}
        elif args[0:3] == ("hypertask", "comment", "list"):
            self.assertEqual(args[4:7], ("--limit", "50", "--json"))
            ticket = args[3]
            self.assertIn(ticket, self.comments)
            cursor = args[8] if len(args) == 9 and args[7] == "--cursor" else None
            self.assertTrue(len(args) == 7 or cursor is not None)
            override = self.replies.get(("comments", ticket, cursor))
            data = override if override is not None else {
                "success": True, "comments": self.comments[ticket], "total": len(self.comments[ticket])}
        elif args == ("tmux", "capture-pane", "-p", "-t", "%1"):
            return "status save 10k"
        elif args in [("tmux", "send-keys", "-t", "%1", "-l", text)
                      for text in ("/clear", "/ship HTPR-1", "/ship HTPR-2", "/ship YPER4-1")]:
            return ""
        elif args == ("tmux", "send-keys", "-t", "%1", "Enter"):
            return ""
        else:
            raise AssertionError(f"Unexpected command: {args!r}")
        if isinstance(data, Exception):
            raise data
        return json.dumps(data)

    def run_dispatch(self, go=True):
        self.calls.clear()
        self.stderr, self.stdout = io.StringIO(), io.StringIO()
        try:
            with contextlib.redirect_stderr(self.stderr), contextlib.redirect_stdout(self.stdout):
                m.run(go, cache_path=self.cache_path, claim_dir=self.claim_dir,
                      loop=self.loop, state=self.state)
        finally:
            lines = [s for s in self.stderr.getvalue().splitlines() if s.startswith("runner-dispatch reads ")]
            self.assertEqual(len(lines), 1)
            match = re.fullmatch(r"runner-dispatch reads task_pages=(\d+) comment_pages=(\d+) "
                                 r"cache_hits=(\d+) full_refresh=(true|false) skipped=(true|false) "
                                 r"uncacheable=(\d+)", lines[0])
            self.assertIsNotNone(match)
            self.summary = match.groups()
            self.assertEqual(int(self.summary[0]), sum(c[:3] == ("hypertask", "tasks", "list") for c in self.calls))
            self.assertEqual(int(self.summary[1]), sum(c[:3] == ("hypertask", "comment", "list") for c in self.calls))

    def cache(self):
        return json.loads(self.cache_path.read_text())

    def put_cache(self, cache):
        self.loop.mkdir(parents=True, exist_ok=True)
        self.cache_path.write_text(json.dumps(cache))

    def fetched(self):
        return [c[3] for c in self.calls if c[:3] == ("hypertask", "comment", "list")]

    def test_warm_unchanged_only_task_lists(self):
        self.run_dispatch()
        self.assertEqual(self.summary, ("2", "3", "0", "true", "false", "0"))
        self.run_dispatch()
        self.assertEqual(self.fetched(), [])
        self.assertTrue(all(c[:3] == ("hypertask", "tasks", "list") for c in self.calls))
        self.assertEqual(self.summary, ("2", "0", "3", "false", "false", "0"))
        self.assertEqual(self.cache()["runs"], 2)
        self.assertEqual(set(self.cache()), {"schema", "runs", "entries"})
        self.assertEqual(set(self.cache()["entries"]), {"15:HTPR-1", "15:HTPR-2", "4060:YPER4-1"})

    def test_count_change_refreshes_only_one(self):
        self.run_dispatch()
        self.boards[15][1]["commentCount"] = 1
        self.comments["HTPR-2"] = [comment("Claimed.")]
        self.run_dispatch()
        self.assertEqual(self.fetched(), ["HTPR-2"])
        self.assertEqual(self.summary[2], "2")
        self.boards[15][0]["commentCount"] = 0
        self.comments["HTPR-1"] = []
        self.run_dispatch()
        self.assertEqual(self.fetched(), ["HTPR-1"])
        self.assertEqual(self.summary[2], "2")

    def test_updated_change_refreshes_only_one(self):
        self.run_dispatch()
        self.boards[15][0]["updatedAt"] = "v2"
        self.run_dispatch()
        self.assertEqual(self.fetched(), ["HTPR-1"])

    def test_twelfth_go_refreshes_all(self):
        self.run_dispatch()
        for unused in range(10):
            self.run_dispatch()
            self.assertEqual(self.fetched(), [])
        self.run_dispatch()
        self.assertEqual(set(self.fetched()), set(self.comments))
        self.assertEqual(self.summary, ("2", "3", "0", "true", "false", "0"))
        self.assertEqual(self.cache()["runs"], 12)
        self.run_dispatch()
        self.assertEqual(self.fetched(), [])

    def test_high_load_zero_reads_or_writes_even_cold(self):
        self.load = 12.01
        with patch.object(Path, "read_text", side_effect=AssertionError("cache read at high load")), \
                patch.object(m.os, "replace", side_effect=AssertionError("write at high load")):
            self.run_dispatch()
        self.assertEqual(self.calls, [])
        self.snap.assert_not_called()
        self.assertEqual(list(self.state.iterdir()), [])
        self.assertEqual(self.summary, ("0", "0", "0", "false", "true", "0"))
        self.assertIn("Load 12.01 > 12: dispatch skipped", self.stderr.getvalue())

    def test_high_load_does_not_advance_warm_cache(self):
        self.run_dispatch()
        before = self.cache_path.read_bytes()
        self.load = 12.01
        self.run_dispatch()
        self.assertEqual(self.cache_path.read_bytes(), before)
        self.assertEqual(self.calls, [])

    def test_exact_load_twelve_runs(self):
        self.load = 12
        self.run_dispatch()
        self.assertEqual(len(self.calls), 5)
        self.assertEqual(self.cache()["runs"], 1)
        self.assertEqual(self.summary[4], "false")

    def test_corrupt_missing_wrong_schema_or_structure_are_cold(self):
        for raw in ("not json", "null", "[]", '{"schema":2,"runs":11,"entries":{}}',
                    '{"schema":true,"runs":11,"entries":{}}',
                    '{"schema":1,"runs":-1,"entries":{}}',
                    '{"schema":1,"runs":true,"entries":{}}',
                    '{"schema":1,"runs":1,"entries":[]}', '{}'):
            with self.subTest(raw=raw):
                self.loop.mkdir(exist_ok=True)
                self.cache_path.write_text(raw)
                self.run_dispatch()
                self.assertEqual(set(self.fetched()), set(self.comments))
                self.assertEqual(self.cache()["runs"], 1)
                self.assertEqual(self.summary[3], "true")

    def test_ill_typed_pages_abort_without_cache_or_dispatch(self):
        for bad in ({}, "", None, 1, [None]):
            with self.subTest(bad=bad), patch.object(m, "dispatch") as dispatch:
                self.replies[("comments", "HTPR-1", None)] = {"success": True, "comments": bad, "total": 0}
                with self.assertRaises(ValueError):
                    self.run_dispatch()
                self.assertFalse(self.cache_path.exists())
                self.assertEqual(list(self.state.iterdir()), [])
                dispatch.assert_not_called()

    def test_short_completed_fetch_dispatches_comments_and_refetches_every_run(self):
        self.boards[15][0]["commentCount"] = 2
        self.comments["HTPR-1"] = [comment("Claimed.")]
        self.rows = [{"runner": "RUNNER 1", "pane": "%1", "state": "done"}]
        with patch.object(m, "dispatch", wraps=m.dispatch) as dispatch:
            for run in range(3):
                self.run_dispatch()
                self.assertIn("HTPR-1", self.fetched())
                self.assertEqual(dispatch.call_args.args[2]["HTPR-1"], self.comments["HTPR-1"])
                self.assertNotIn("15:HTPR-1", self.cache()["entries"])
                self.assertNotIn("sent=HTPR-1", self.stdout.getvalue())
                self.assertEqual(self.summary[5], "1")
                self.assertEqual(self.summary[2], "0" if run == 0 else "2")
                if run == 0:
                    self.assertIn("sent=HTPR-2", self.stdout.getvalue())
                else:
                    self.assertEqual(self.fetched(), ["HTPR-1"])

    def test_empty_completed_page_refetches_and_sees_recovered_claim_next_run(self):
        self.comments["HTPR-1"] = []
        self.run_dispatch()
        self.assertNotIn("15:HTPR-1", self.cache()["entries"])
        self.assertEqual(self.summary[5], "1")
        self.comments["HTPR-1"] = [comment("Claimed.")]
        self.rows = [{"runner": "RUNNER 1", "pane": "%1", "state": "done"}]
        self.run_dispatch()
        self.assertEqual(self.fetched(), ["HTPR-1"])
        self.assertIn("sent=HTPR-2", self.stdout.getvalue())
        self.assertNotIn("sent=HTPR-1", self.stdout.getvalue())
        self.assertEqual(self.cache()["entries"]["15:HTPR-1"]["comments"], self.comments["HTPR-1"])
        self.assertEqual(self.summary[5], "0")

    def test_short_cached_entry_is_a_miss_and_is_removed_if_still_short(self):
        self.run_dispatch()
        data = self.cache()
        data["entries"]["15:HTPR-1"]["comments"] = []
        self.boards[15][0]["commentCount"] = 2
        data["entries"]["15:HTPR-1"]["commentCount"] = 2
        self.put_cache(data)
        self.comments["HTPR-1"] = [comment("Claimed.")]
        with patch.object(m, "dispatch", wraps=m.dispatch) as dispatch:
            self.run_dispatch()
        self.assertEqual(self.fetched(), ["HTPR-1"])
        self.assertEqual(dispatch.call_args.args[2]["HTPR-1"], self.comments["HTPR-1"])
        self.assertNotIn("15:HTPR-1", self.cache()["entries"])
        self.assertEqual(self.summary[2], "2")
        self.assertEqual(self.summary[5], "1")

    def test_duplicate_short_task_is_fetched_and_counted_once(self):
        self.boards[15][0]["commentCount"] = 2
        self.boards[15].append(copy.deepcopy(self.boards[15][0]))
        self.run_dispatch()
        self.assertEqual(self.fetched().count("HTPR-1"), 1)
        self.assertEqual(self.summary[5], "1")

    def test_multiple_short_tasks_are_counted_and_not_cached(self):
        self.boards[15][0]["commentCount"] = 2
        self.comments["YPER4-1"] = []
        for unused in range(2):
            self.run_dispatch()
            self.assertEqual(self.summary[5], "2")
            self.assertEqual(set(self.cache()["entries"]), {"15:HTPR-2"})
            self.assertTrue({"HTPR-1", "YPER4-1"}.issubset(self.fetched()))

    def test_incomplete_or_failed_fetch_still_aborts_without_dispatch_or_cache_changes(self):
        self.run_dispatch()
        before = self.cache_path.read_bytes()
        self.boards[15][0]["commentCount"] = 2
        for response in (
                {"success": False, "comments": [], "total": 0},
                {"success": True, "comments": [], "total": 1},
                {"success": True, "comments": [], "has_more": True},
                {"success": True, "comments": [comment()], "total": 2, "nextCursor": "again"},
                json.JSONDecodeError("bad JSON", "bad", 0),
                RuntimeError("command failed"),
                subprocess.CalledProcessError(1, "hypertask")):
            with self.subTest(response=response):
                self.replies[("comments", "HTPR-1", None)] = response
                self.replies[("comments", "HTPR-1", "again")] = response
                with patch.object(m, "dispatch") as dispatch:
                    with self.assertRaises((ValueError, RuntimeError, subprocess.SubprocessError)):
                        self.run_dispatch()
                dispatch.assert_not_called()
                self.assertEqual(self.cache_path.read_bytes(), before)
                self.assertEqual(self.summary[5], "0")

    def test_complete_paginated_short_list_is_used_and_refetched(self):
        self.boards[15][0]["commentCount"] = 3
        listed = [comment(), comment("Claimed.", ident=2)]
        self.replies[("comments", "HTPR-1", None)] = {
            "success": True, "comments": listed[:1], "total": 2, "nextCursor": "next"}
        self.replies[("comments", "HTPR-1", "next")] = {
            "success": True, "comments": listed[1:], "total": 2, "has_more": True}
        with patch.object(m, "dispatch", wraps=m.dispatch) as dispatch:
            for unused in range(2):
                self.run_dispatch()
                self.assertEqual(self.fetched().count("HTPR-1"), 2)
                self.assertEqual(dispatch.call_args.args[2]["HTPR-1"], listed)
                self.assertNotIn("15:HTPR-1", self.cache()["entries"])
                self.assertEqual(self.summary[5], "1")

    def test_dispatch_source_has_no_unsupported_activity_flag(self):
        unsupported = "--include-" + "activity"
        self.assertNotIn(unsupported, SOURCE.read_text())

    def test_more_than_count_is_fine_and_activities_never_claim(self):
        self.comments["HTPR-2"] = [dict(comment("Claimed."), type="activity")]
        self.rows = [{"runner": "RUNNER 1", "pane": "%1", "state": "done"}]
        self.run_dispatch(go=False)
        self.assertIn("planned=HTPR-1", self.stdout.getvalue())
        self.comments["HTPR-1"] = [dict(comment("Claimed."), type="activity")]
        self.run_dispatch()
        self.assertIn("sent=HTPR-1", self.stdout.getvalue())
        self.assertEqual(self.cache()["entries"]["15:HTPR-1"]["comments"][0]["type"], "activity")

    def test_cached_inconsistent_or_invalid_entry_is_refetched(self):
        self.run_dispatch()
        good = self.cache()
        for entry in ({}, None, {"updatedAt": "v1", "commentCount": 1, "comments": []},
                      {"updatedAt": "v1", "commentCount": True, "comments": [comment()]},
                      {"updatedAt": "v1", "commentCount": 1.0, "comments": [comment()]},
                      {"updatedAt": "v1", "commentCount": 1, "comments": {}},
                      {"updatedAt": "v1", "commentCount": 1, "comments": [None]}):
            with self.subTest(entry=entry):
                data = copy.deepcopy(good)
                data["entries"]["15:HTPR-1"] = entry
                self.put_cache(data)
                self.run_dispatch()
                self.assertEqual(self.fetched(), ["HTPR-1"])

    def test_missing_or_invalid_task_metadata_always_refetches(self):
        for field, value in (("updatedAt", None), ("updatedAt", ""), ("commentCount", None),
                             ("commentCount", "1"), ("commentCount", True), ("commentCount", -1)):
            with self.subTest(field=field, value=value):
                self.boards[15][0][field] = value
                self.run_dispatch()
                self.run_dispatch()
                self.assertIn("HTPR-1", self.fetched())
                self.boards[15][0] = {"ticketNumber": "HTPR-1", "title": "first", "section": "Bugs",
                                      "updatedAt": "v1", "commentCount": 1}
        for field in ("updatedAt", "commentCount"):
            del self.boards[15][0][field]
            self.run_dispatch()
            self.run_dispatch()
            self.assertIn("HTPR-1", self.fetched())

    def test_failed_dispatch_does_not_advance_runs_or_prune(self):
        self.run_dispatch()
        before = self.cache_path.read_bytes()
        self.boards[15][0]["updatedAt"] = "v2"
        with patch.object(m, "dispatch", side_effect=RuntimeError("dispatch failure")):
            with self.assertRaises(RuntimeError):
                self.run_dispatch()
        self.assertEqual(self.cache_path.read_bytes(), before)
        self.assertEqual(list(self.loop.glob("*.tmp.*")), [])
        self.run_dispatch()
        self.assertEqual(self.fetched(), ["HTPR-1"])
        self.assertEqual(self.cache()["runs"], 2)

    def test_failed_cold_dispatch_writes_nothing(self):
        with patch.object(m, "dispatch", side_effect=RuntimeError("dispatch failure")):
            with self.assertRaises(RuntimeError):
                self.run_dispatch()
        self.assertEqual(list(self.state.iterdir()), [])

    def test_dry_run_cold_and_warm_write_nothing_and_do_not_count(self):
        self.run_dispatch(go=False)
        self.assertEqual(list(self.state.iterdir()), [])
        self.run_dispatch()
        data = self.cache()
        data["runs"] = 11
        self.put_cache(data)
        before = self.cache_path.read_bytes()
        self.run_dispatch(go=False)
        self.assertEqual(self.fetched(), [])
        self.assertEqual(self.cache_path.read_bytes(), before)
        self.run_dispatch()
        self.assertEqual(len(self.fetched()), 3)

    def test_prunes_absent_and_irrelevant_entries_after_complete_board_read(self):
        self.run_dispatch()
        self.boards[15].pop(0)
        self.boards[4060][0]["section"] = "Done"
        self.run_dispatch()
        self.assertEqual(set(self.cache()["entries"]), {"15:HTPR-2"})
        self.assertEqual(self.fetched(), [])

    def test_task_pagination_failure_preserves_cache_and_skips_dispatch(self):
        self.run_dispatch()
        before = self.cache_path.read_bytes()
        self.replies[("tasks", 4060, None)] = {"success": True, "tasks": [], "total": 1}
        with patch.object(m, "dispatch") as dispatch, self.assertRaises(ValueError):
            self.run_dispatch()
        dispatch.assert_not_called()
        self.assertEqual(self.cache_path.read_bytes(), before)

    def test_summary_counts_every_page_and_cache_hit(self):
        self.replies[("tasks", 15, None)] = {"success": True, "tasks": self.boards[15][:1],
                                           "total": 2, "nextCursor": "next"}
        self.replies[("tasks", 15, "next")] = {"success": True, "tasks": self.boards[15][1:], "total": 2}
        self.comments["HTPR-1"].append(comment(ident=2))
        self.replies[("comments", "HTPR-1", None)] = {"success": True, "comments": self.comments["HTPR-1"][:1],
                                                     "total": 2, "nextCursor": "next"}
        self.replies[("comments", "HTPR-1", "next")] = {"success": True, "comments": self.comments["HTPR-1"][1:], "total": 2}
        self.run_dispatch()
        self.assertEqual(self.summary, ("3", "4", "0", "true", "false", "0"))
        self.run_dispatch()
        self.assertEqual(self.summary, ("3", "0", "3", "false", "false", "0"))
        self.assertNotIn("note", self.stderr.getvalue())
        self.assertNotIn("HTPR", self.stderr.getvalue())

    def test_comment_failure_after_other_refresh_preserves_all_cache(self):
        self.run_dispatch()
        data = self.cache()
        data["runs"] = 11
        self.put_cache(data)
        before = self.cache_path.read_bytes()
        self.replies[("comments", "YPER4-1", None)] = RuntimeError("fetch failed")
        with patch.object(m, "dispatch") as dispatch, self.assertRaises(RuntimeError):
            self.run_dispatch()
        dispatch.assert_not_called()
        self.assertEqual(self.cache_path.read_bytes(), before)
        self.assertEqual(self.summary[:2], ("2", "3"))

    def test_truncated_dispatch_state_does_not_halt_next_run(self):
        self.loop.mkdir()
        path = self.loop / "last-dispatch.json"
        path.write_text('{"%1":')
        self.rows = [{"runner": "RUNNER 1", "pane": "%1", "state": "done"}]
        replace = os.replace
        replaced = []
        def check_replace(source, target):
            if target == path:
                self.assertEqual(path.read_text(), '{"%1":')
                self.assertEqual(source.parent, path.parent)
                self.assertEqual(json.loads(source.read_text()), {"%1": self.now})
                replaced.append(target)
            replace(source, target)
        with patch.object(m.os, "replace", side_effect=check_replace):
            self.run_dispatch()
        self.assertIn("sent=HTPR-1", self.stdout.getvalue())
        self.assertEqual(replaced, [path])
        self.assertEqual(json.loads(path.read_text()), {"%1": self.now})
        self.assertEqual(self.cache()["runs"], 1)
        self.assertEqual(self.stderr.getvalue().count("malformed last-dispatch.json"), 1)
        self.assertEqual(list(self.loop.glob("*.tmp.*")), [])

    def test_atomic_replace_in_same_directory_only_after_dispatch(self):
        replace = os.replace
        with patch.object(m, "dispatch", return_value=[]) as dispatch:
            def check_replace(source, target):
                dispatch.assert_called_once()
                self.assertEqual(Path(source).parent, self.cache_path.parent)
                self.assertEqual(target, self.cache_path)
                self.assertFalse(self.cache_path.exists())
                self.assertEqual(json.loads(Path(source).read_text())["runs"], 1)
                replace(source, target)
            with patch.object(m.os, "replace", side_effect=check_replace) as mocked:
                self.run_dispatch()
                mocked.assert_called_once()
        self.assertEqual(list(self.loop.glob("*.tmp.*")), [])

    def test_replace_failure_preserves_old_cache_and_removes_temp(self):
        self.run_dispatch()
        before = self.cache_path.read_bytes()
        with patch.object(m.os, "replace", side_effect=OSError("replace failed")):
            with self.assertRaises(OSError):
                self.run_dispatch()
        self.assertEqual(self.cache_path.read_bytes(), before)
        self.assertEqual(list(self.loop.glob("*.tmp.*")), [])

    def test_claim_appears_without_metadata_change_seen_by_twelfth_run(self):
        for unused in range(12):
            self.run_dispatch()
        started = self.now
        self.comments["HTPR-1"] = [comment("Claimed.")]
        self.rows = [{"runner": "RUNNER 1", "pane": "%1", "state": "busy"}]
        for unused in range(11):
            self.now += 300
            self.run_dispatch()
            self.assertEqual(self.fetched(), [])
        self.now += 300
        self.rows[0]["state"] = "done"
        self.run_dispatch()
        self.assertNotIn("sent=HTPR-1", self.stdout.getvalue())
        self.assertIn("sent=HTPR-2", self.stdout.getvalue())
        self.assertEqual(self.cache()["runs"], 24)
        self.assertEqual(self.now - started, 3600)

    def test_new_claim_count_change_is_seen_before_dispatch(self):
        self.run_dispatch()
        self.comments["HTPR-1"].append(comment("Claimed.", ident=2))
        self.boards[15][0]["commentCount"] = 2
        self.rows = [{"runner": "RUNNER 1", "pane": "%1", "state": "done"}]
        self.run_dispatch()
        self.assertEqual(self.fetched(), ["HTPR-1"])
        self.assertIn("sent=HTPR-2", self.stdout.getvalue())
        self.assertNotIn("sent=HTPR-1", self.stdout.getvalue())

    def test_edited_claim_updated_change_is_seen_before_dispatch(self):
        self.run_dispatch()
        self.comments["HTPR-1"] = [comment("Claimed.")]
        self.boards[15][0]["updatedAt"] = "v2"
        self.rows = [{"runner": "RUNNER 1", "pane": "%1", "state": "done"}]
        self.run_dispatch()
        self.assertEqual(self.fetched(), ["HTPR-1"])
        self.assertIn("sent=HTPR-2", self.stdout.getvalue())
        self.assertNotIn("sent=HTPR-1", self.stdout.getvalue())

    def test_cached_free_ticket_local_claim_prevents_second_runner(self):
        self.boards[15] = self.boards[15][:1]
        self.boards[4060] = []
        self.rows = [{"runner": "RUNNER 1", "pane": "%1", "state": "done"}]
        self.run_dispatch()
        self.assertIn("sent=HTPR-1", self.stdout.getvalue())
        self.rows = [{"runner": "RUNNER 2", "pane": "%2", "state": "done"}]
        self.run_dispatch()
        self.assertEqual(self.fetched(), [])
        self.assertIn("planned=none", self.stdout.getvalue())
        self.assertEqual(len(list(self.claim_dir.iterdir())), 1)

    def test_main_holds_existing_lock_through_fetch_dispatch_and_replace(self):
        actual_run = m.run
        flock = m.fcntl.flock
        locked = []
        def run(go, *, cache_path):
            self.assertTrue(locked)
            self.assertEqual(cache_path, self.cache_path)
            actual_run(go, cache_path=cache_path, claim_dir=self.claim_dir, loop=self.loop, state=self.state)
        def lock(fd, operation):
            self.assertEqual(operation, m.fcntl.LOCK_EX)
            flock(fd, operation)
            locked.append(fd)
        replace = os.replace
        def check_replace(source, target):
            self.assertFalse(locked[0].closed)
            replace(source, target)
        with patch.object(m, "LOOP", self.loop), patch.object(sys, "argv", [str(SOURCE), "--go"]), \
                patch.object(m.fcntl, "flock", side_effect=lock), patch.object(m, "run", side_effect=run), \
                patch.object(m.os, "replace", side_effect=check_replace), \
                contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
            m.main()
        self.assertTrue(locked[0].closed)
        self.assertEqual(self.cache()["runs"], 1)

    def test_two_processes_can_only_acquire_one_ticket_once(self):
        ctx = multiprocessing.get_context("fork")
        barrier = ctx.Barrier(2)
        queue = ctx.Queue()
        def acquire(runner):
            barrier.wait(timeout=5)
            row = {"runner": runner, "pane": "%1"}
            queue.put(m.acquire_claim("HTPR-1", row, self.claim_dir, self.now))
        processes = [ctx.Process(target=acquire, args=(f"RUNNER {n}",)) for n in (1, 2)]
        try:
            for process in processes:
                process.start()
            self.assertEqual(sorted(queue.get(timeout=5) for unused in processes), [False, True])
            for process in processes:
                process.join(timeout=5)
                self.assertEqual(process.exitcode, 0)
            self.assertEqual([p.name for p in self.claim_dir.iterdir()], ["HTPR-1.json"])
        finally:
            for process in processes:
                if process.is_alive():
                    process.terminate()
                    process.join()
            queue.close()
            queue.join_thread()


class MutationTests(unittest.TestCase):
    def test_new_tests_kill_cache_reversion_mutants(self):
        source = SOURCE.read_text()
        mutants = [
            ("always_fetch", 'if valid and not full_refresh:', 'if False:',
             'test_warm_unchanged_only_task_lists'),
            ("never_periodic_refresh", 'full_refresh = full_refresh or (go and (cache["runs"] + 1) % 12 == 0)',
             'full_refresh = full_refresh', 'test_twelfth_go_refreshes_all'),
            ("ignore_count_change", 'and entry.get("commentCount") == count', '',
             'test_count_change_refreshes_only_one'),
            ("ignore_updated_change", 'entry.get("updatedAt") == updated', 'True',
             'test_updated_change_refreshes_only_one'),
        ]
        with tempfile.TemporaryDirectory() as directory:
            for name, old, new, test in mutants:
                with self.subTest(mutant=name):
                    self.assertEqual(source.count(old), 1)
                    mutant = Path(directory) / name
                    mutant.write_text(source.replace(old, new))
                    result = subprocess.run(["nice", "-n", "19", sys.executable, "-I",
                                             str(Path(__file__).resolve()), f"CacheTests.{test}"],
                                            env=dict(os.environ, DISPATCH_TEST_SOURCE=str(mutant),
                                                     PYTHONDONTWRITEBYTECODE="1"),
                                            text=True, capture_output=True, timeout=30)
                    self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertIn("AssertionError", result.stderr)
                    self.assertNotIn("TypeError", result.stderr)
                    self.assertNotIn("Unexpected command", result.stderr)
                    print(f"MUTATION KILLED {name}: CacheTests.{test}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
