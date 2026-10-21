#!/usr/bin/env python3
"""JSON fixture tests; external commands and sleeps are always mocked."""
import importlib.machinery
import importlib.util
import json
import os
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).with_name("runner-dispatch")
loader = importlib.machinery.SourceFileLoader("runner_dispatch", str(SOURCE))
spec = importlib.util.spec_from_loader(loader.name, loader)
m = importlib.util.module_from_spec(spec)
loader.exec_module(m)

FIXTURE = r'''
{
  "rows": [
    {"runner":"RUNNER 1","pane":"%1","state":"done"},
    {"runner":"RUNNER 2","pane":"%2","state":"idle"},
    {"runner":"RUNNER 3","pane":"%3","state":"busy"},
    {"runner":"RUNNER 4","pane":"%4","state":"typed"},
    {"runner":"RUNNER 5","pane":"%5","state":"waiting_valentin"},
    {"runner":"RUNNER 6","pane":"%6","state":"waiting_bg"},
    {"runner":"RUNNER 7","pane":"%7","state":"gone"},
    {"runner":"RUNNER 8","pane":"%8","state":"idle"},
    {"runner":"SPEED RUNNER","pane":"%9","state":"done"}
  ],
  "boards": {
    "15": [
      {"ticketNumber":"HTPR-1","title":"Top Bug","section":"Bugs","assignees":[]},
      {"ticketNumber":"HTPR-2","title":"Next Bug","section":"Bugs","assignees":[]},
      {"ticketNumber":"HTPR-3","title":"Todo work","section":"Todo","assignees":[]},
      {"ticketNumber":"HTPR-4","title":"Current work","section":"In Progress","assignees":[]}
    ],
    "4060": [
      {"ticketNumber":"YPER4-1","title":"Backlog work","section":"Backlog","assignees":[]}
    ]
  },
  "comments": {"HTPR-1":[],"HTPR-2":[],"HTPR-3":[],"HTPR-4":[],"YPER4-1":[]}
}
'''


def claim(runner, at="2026-10-18T10:00:00Z", text="<strong>Claimed.</strong>"):
    return json.loads(json.dumps({"id": 1, "text": text, "createdAt": at,
                                  "creator": {"displayName": "Not the claimer"},
                                  "agent": {"displayName": runner}}))


class DispatchTests(unittest.TestCase):
    def setUp(self):
        fixture = json.loads(FIXTURE)
        self.rows = fixture["rows"]
        self.boards = {int(k): v for k, v in fixture["boards"].items()}
        self.comments = fixture["comments"]
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name)
        self.claim_dir = self.state / "runner-queue/claims"
        self.loop = self.state / "runner-loop"
        self.now = 1800000000
        self.commands = patch.object(m, "command", side_effect=AssertionError("Unmocked external command")).start()
        self.addCleanup(patch.stopall)
        self.sleep = patch.object(m.time, "sleep").start()

    def dispatch(self, rows=None, load=1, go=False):
        return m.dispatch(self.rows if rows is None else rows, self.boards, self.comments,
                          load, self.now, go=go, claim_dir=self.claim_dir, loop=self.loop, state=self.state)

    def file_claim(self, ticket, owner=m.OWNER):
        self.claim_dir.mkdir(parents=True, exist_ok=True)
        path = self.claim_dir / f"{ticket}.json"
        path.write_text(json.dumps({"ticket": ticket, "owner": owner}))
        return path

    def ready_go(self, fresh=None):
        patch.object(m, "snapshots", return_value=fresh if fresh is not None else self.rows).start()
        patch.object(m.os, "getloadavg", return_value=(1, 1, 1)).start()
        patch.object(m.time, "time", return_value=self.now).start()
        self.commands.side_effect = None
        self.commands.return_value = "status save 123k"

    def test_done_gets_top_bug_and_dry_run_writes_nothing(self):
        self.assertEqual(self.dispatch()[0]["ticket"], "HTPR-1")
        self.assertEqual(list(self.state.iterdir()), [])
        self.commands.assert_not_called()
        self.sleep.assert_not_called()

    def test_holding_active_ticket_case_insensitive_newest_claim(self):
        self.rows[0]["state"] = "idle"
        self.comments["HTPR-4"] = [claim("Runner 1"), claim("Runner 2", "2026-10-17T10:00:00Z")]
        result = self.dispatch()
        self.assertIsNone(result[0]["ticket"])
        self.assertEqual(result[0]["held"], ["HTPR-4"])
        self.assertEqual(result[1]["ticket"], "HTPR-1")
        self.comments["HTPR-4"].append(claim("RUNNER 2", "2026-10-19T10:00:00Z"))
        self.assertEqual(self.dispatch()[0]["ticket"], "HTPR-1")
        self.assertIsNone(self.dispatch()[1]["ticket"])

    def test_done_runner_with_stale_holds_still_dispatched(self):
        self.comments["HTPR-4"] = [claim("RUNNER 1")]
        result = self.dispatch()
        self.assertEqual(result[0]["held"], ["HTPR-4"])
        self.assertEqual(result[0]["ticket"], "HTPR-1")

    def test_holding_ai_review_and_qa_on_either_board(self):
        self.rows[0]["state"] = "idle"
        for column in ("AI Review", "QA"):
            self.boards[4060][0]["section"] = column
            self.comments["YPER4-1"] = [claim("RUNNER 1")]
            self.assertIsNone(self.dispatch()[0]["ticket"])

    def test_idle_skips_existing_claim_file(self):
        self.rows[0]["state"] = "idle"
        self.file_claim("HTPR-1", "Mini Boss CEO")
        self.assertEqual(self.dispatch()[0]["ticket"], "HTPR-2")

    def test_runner8_never_dispatches(self):
        self.assertIsNone(self.dispatch(self.rows[7:8])[0]["ticket"])

    def add_speed_ticket(self):
        self.boards[15].append({"ticketNumber": "HTPR-9", "title": "[SPEED] Board loads slowly", "section": "Todo", "assignees": []})
        self.comments["HTPR-9"] = []

    def test_speed_runner_gets_top_free_speed_ticket(self):
        self.add_speed_ticket()
        self.assertEqual(self.dispatch(self.rows[8:])[0]["ticket"], "HTPR-9")

    def test_speed_tickets_never_go_to_normal_runners(self):
        self.add_speed_ticket()
        self.boards[15] = [t for t in self.boards[15] if t["ticketNumber"] == "HTPR-9"]
        self.boards[4060] = []
        self.assertIsNone(self.dispatch(self.rows[:1])[0]["ticket"])

    def test_speed_research_when_no_speed_ticket_and_waiting_counts(self):
        row = dict(self.rows[8], state="waiting_valentin")
        self.assertEqual(self.dispatch([row])[0]["ticket"], "research")
        self.assertIsNone(self.dispatch([dict(row, state="busy")])[0]["ticket"])

    def test_speed_research_sent_once_per_six_hours(self):
        self.ready_go()
        self.assertEqual(self.dispatch(self.rows[8:], go=True)[0]["action"], "sent")
        self.now += 3600
        self.assertIsNone(self.dispatch(self.rows[8:], go=True)[0]["ticket"])
        self.now += m.RESEARCH_EVERY
        self.assertEqual(self.dispatch(self.rows[8:], go=True)[0]["ticket"], "research")

    def test_word_speed_in_title_is_not_a_speed_ticket(self):
        self.boards[15] = [{"ticketNumber": "HTPR-8", "title": "Speed goals for the speed runner", "section": "Todo", "assignees": []}]
        self.boards[4060] = []
        self.comments["HTPR-8"] = []
        self.assertEqual(self.dispatch(self.rows[8:])[0]["ticket"], "research")
        self.assertEqual(self.dispatch(self.rows[:1])[0]["ticket"], "HTPR-8")

    def test_speed_label_marks_a_speed_ticket(self):
        self.boards[15] = [{"ticketNumber": "HTPR-7", "title": "Board loads slowly", "section": "Todo", "assignees": [], "labels": [{"name": "SPEED ⚡"}]}]
        self.boards[4060] = []
        self.comments["HTPR-7"] = []
        self.assertEqual(self.dispatch(self.rows[8:])[0]["ticket"], "HTPR-7")

    def test_speed_runner_holds_at_high_load(self):
        self.add_speed_ticket()
        self.assertIsNone(self.dispatch(self.rows[8:], load=13)[0]["ticket"])

    def test_high_load_no_dispatch_or_go_effects(self):
        self.assertTrue(all(row["ticket"] is None for row in self.dispatch(load=12.01, go=True)))
        self.assertEqual(list(self.state.iterdir()), [])
        self.commands.assert_not_called()
        self.assertEqual(self.dispatch(load=12)[0]["ticket"], "HTPR-1")

    def test_claimed_and_abdul_tickets_skipped(self):
        self.comments["HTPR-1"] = [claim("Someone else", text="Claimed.")]
        self.boards[15][1]["assignees"] = [{"displayName": "ABDUL Rahman"}]
        self.assertEqual(self.dispatch()[0]["ticket"], "HTPR-3")

    def test_agent_assignees_and_do_not_touch_skipped(self):
        self.boards[15][0]["assignees"] = [{"agent": {"displayName": "Runner 3"}}]
        self.boards[15][1]["title"] = "Please DO NOT TOUCH this"
        self.boards[15][2]["agents"] = [{"displayName": "Runner 4"}]
        self.assertEqual(self.dispatch()[0]["ticket"], "YPER4-1")

    def test_creator_agent_not_an_assignee(self):
        self.boards[15][0]["agent"] = {"displayName": "Runner 3"}
        self.assertEqual(self.dispatch()[0]["ticket"], "HTPR-1")

    def test_review_columns_never_candidates(self):
        self.boards[15][0]["section"] = "Valentin Review"
        self.boards[15][1]["section"] = "UX Sign-off"
        self.assertEqual(self.dispatch()[0]["ticket"], "HTPR-3")

    def test_priority_and_board_order_no_duplicate_assignments(self):
        for row in self.rows[:7]:
            row["state"] = "done"
        self.assertEqual([r["ticket"] for r in self.dispatch()[:7]],
                         ["HTPR-1", "HTPR-2", "HTPR-3", "YPER4-1", None, None, None])

    def test_cooldown_per_pane_and_boundary(self):
        self.loop.mkdir()
        path = self.loop / "last-dispatch.json"
        path.write_text(json.dumps({"%1": self.now - 599}))
        self.assertIsNone(self.dispatch()[0]["ticket"])
        self.assertEqual(self.dispatch()[1]["ticket"], "HTPR-1")
        path.write_text(json.dumps({"%1": self.now - 600}))
        self.assertEqual(self.dispatch()[0]["ticket"], "HTPR-1")

    def test_atomic_link_claim_conflict_preserves_owner_and_removes_tmp(self):
        path = self.file_claim("HTPR-1", "Mini Boss CEO")
        before = path.read_bytes()
        self.assertFalse(m.acquire_claim("HTPR-1", self.rows[0], self.claim_dir, self.now))
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(list(self.claim_dir.glob("*.tmp.*")), [])
        self.assertTrue(m.acquire_claim("HTPR-2", self.rows[0], self.claim_dir, self.now))
        data = json.loads((self.claim_dir / "HTPR-2.json").read_text())
        self.assertEqual(set(data), {"ticket", "pane", "runner", "owner", "at"})
        self.assertEqual(data["owner"], m.OWNER)
        self.assertTrue(data["at"].endswith("+00:00"))

    def test_go_collision_tries_next_ticket(self):
        self.ready_go()
        acquire = m.acquire_claim
        def collision(ticket, *args):
            if ticket == "HTPR-1":
                self.file_claim(ticket, "Mini Boss CEO")
            return acquire(ticket, *args)
        with patch.object(m, "acquire_claim", side_effect=collision):
            self.assertEqual(self.dispatch(self.rows[:1], go=True)[0]["ticket"], "HTPR-2")

    def test_go_recheck_aborts_typed_busy_missing_or_overload(self):
        for state in ("typed", "busy", "waiting_bg", "gone", "missing", "overload"):
            fresh = [dict(self.rows[0], state=state)] if state != "missing" else []
            self.ready_go(fresh)
            if state == "overload":
                fresh[0]["state"] = "idle"
                patch.object(m.os, "getloadavg", return_value=(13, 1, 1)).start()
            self.commands.reset_mock()
            result = self.dispatch(self.rows[:1], go=True)
            self.assertIsNone(result[0]["ticket"])
            self.assertFalse(any("send-keys" in call.args for call in self.commands.call_args_list))
            self.assertEqual(list(self.claim_dir.iterdir()), [])
            self.assertFalse((self.loop / "last-dispatch.json").exists())

    def test_aborted_pane_leaves_top_ticket_for_next_runner(self):
        self.ready_go([dict(self.rows[0], state="busy"), self.rows[1]])
        result = self.dispatch(self.rows[:2], go=True)
        self.assertIsNone(result[0]["ticket"])
        self.assertEqual(result[1]["ticket"], "HTPR-1")

    def test_snapshot_failure_releases_unsent_claim(self):
        self.ready_go()
        with patch.object(m, "snapshots", side_effect=RuntimeError("snapshot failed")):
            with self.assertRaises(RuntimeError):
                self.dispatch(self.rows[:1], go=True)
        self.assertEqual(list(self.claim_dir.iterdir()), [])
        self.assertFalse((self.loop / "last-dispatch.json").exists())

    def test_speed_go_rechecks_pane_and_load_for_ticket_and_research(self):
        for research in (False, True):
            for state in ("typed", "busy", "waiting_bg", "gone", "missing", "wrong_runner", "duplicate", "overload"):
                with self.subTest(research=research, state=state):
                    if not research:
                        self.add_speed_ticket()
                    else:
                        self.boards[15] = [t for t in self.boards[15] if t["ticketNumber"] != "HTPR-9"]
                    row = self.rows[8]
                    fresh = [dict(row, state=state)]
                    if state == "missing":
                        fresh = []
                    elif state == "wrong_runner":
                        fresh = [dict(row, runner="RUNNER 1")]
                    elif state == "duplicate":
                        fresh = [row, row]
                    elif state == "overload":
                        fresh = [row]
                    self.ready_go(fresh)
                    if state == "overload":
                        patch.object(m.os, "getloadavg", return_value=(13, 1, 1)).start()
                    self.commands.reset_mock()
                    with patch.object(m, "acquire_claim", wraps=m.acquire_claim) as acquire:
                        result = self.dispatch([row], go=True)[0]
                    self.assertEqual(acquire.call_count, 0 if research else 1)
                    self.assertIsNone(result["ticket"])
                    self.assertFalse(any("send-keys" in c.args for c in self.commands.call_args_list))
                    self.assertEqual(list(self.claim_dir.glob("*.json")), [])
                    self.assertFalse((self.loop / "last-dispatch.json").exists())

    def test_speed_snapshot_failure_releases_unsent_claim(self):
        self.add_speed_ticket()
        self.ready_go()
        with patch.object(m, "snapshots", side_effect=RuntimeError("snapshot failed")):
            with self.assertRaisesRegex(RuntimeError, "snapshot failed"):
                self.dispatch(self.rows[8:], go=True)
        self.assertFalse((self.claim_dir / "HTPR-9.json").exists())
        self.commands.assert_not_called()
        self.assertFalse((self.loop / "last-dispatch.json").exists())

    def test_speed_go_accepts_fresh_allowed_states(self):
        self.add_speed_ticket()
        for state in ("done", "idle", "waiting_valentin"):
            with self.subTest(state=state):
                self.ready_go([dict(self.rows[8], state=state)])
                result = self.dispatch(self.rows[8:], go=True)[0]
                self.assertEqual((result["action"], result["ticket"]), ("sent", "HTPR-9"))
                sent = [c.args for c in self.commands.call_args_list if "send-keys" in c.args]
                self.assertEqual(sent[-2:], [("tmux", "send-keys", "-t", "%9", "-l", "/ship HTPR-9"),
                                             ("tmux", "send-keys", "-t", "%9", "Enter")])
                (self.claim_dir / "HTPR-9.json").unlink()
                self.now += 600

    def test_first_send_failure_releases_claim_and_ticket_is_free_next_run(self):
        self.add_speed_ticket()
        for row, ticket in ((self.rows[0], "HTPR-1"), (self.rows[8], "HTPR-9")):
            with self.subTest(runner=row["runner"]):
                self.ready_go()
                def fail_first(*args):
                    if "send-keys" in args:
                        raise RuntimeError("tmux rejected send")
                    return "status save 123k"
                self.commands.side_effect = fail_first
                with self.assertRaisesRegex(RuntimeError, "tmux rejected send"):
                    self.dispatch([row], go=True)
                self.assertFalse((self.claim_dir / f"{ticket}.json").exists())
                self.assertIn(ticket, m.free_tickets(self.boards, self.comments, self.claim_dir))
                self.ready_go()
                self.assertEqual(self.dispatch([row], go=True)[0]["ticket"], ticket)

    def test_partial_delivery_keeps_claim_until_expiry_then_retries(self):
        self.add_speed_ticket()
        for row, ticket in ((self.rows[0], "HTPR-1"), (self.rows[8], "HTPR-9")):
            for failed_send in (1, 2, 3, 4):
                with self.subTest(runner=row["runner"], failed_send=failed_send):
                    self.ready_go()
                    attempts = []
                    def fail_partial(*args):
                        if "send-keys" in args:
                            attempts.append(args)
                            if len(attempts) == failed_send:
                                if failed_send == 1:
                                    raise subprocess.TimeoutExpired("tmux", 60)
                                raise RuntimeError("partial send failed")
                        return "status save 123k"
                    self.commands.side_effect = fail_partial
                    with self.assertRaises((RuntimeError, subprocess.TimeoutExpired)):
                        self.dispatch([row], go=True)
                    path = self.claim_dir / f"{ticket}.json"
                    data = json.loads(path.read_text())
                    self.assertEqual(data["failed_delivery_until"], self.now + m.FAILED_DELIVERY_TTL)
                    self.assertEqual(data["owner"], m.OWNER)
                    self.assertEqual(list(self.claim_dir.glob("*.tmp.*")), [])
                    self.assertNotIn(ticket, m.free_tickets(self.boards, self.comments, self.claim_dir))
                    self.now += m.FAILED_DELIVERY_TTL - 1
                    self.dispatch([], go=True)
                    self.assertTrue(path.exists())
                    self.now += 1
                    before = path.read_bytes()
                    self.dispatch([], go=False)
                    self.assertEqual(path.read_bytes(), before)
                    self.ready_go()
                    result = self.dispatch([row], go=True)[0]
                    self.assertEqual((result["action"], result["ticket"]), ("sent", ticket))
                    self.assertNotIn("failed_delivery_until", json.loads(path.read_text()))
                    path.unlink()
                    self.now += 600

    def test_expired_delivery_cleanup_preserves_other_claims_and_board_claims(self):
        own = self.file_claim("HTPR-1")
        other = self.file_claim("HTPR-2", "Mini Boss CEO")
        active = self.file_claim("HTPR-3")
        for name, raw in (("broken", "not json"), ("empty", "[]")):
            (self.claim_dir / f"{name}.json").write_text(raw)
        for path in (own, other):
            data = json.loads(path.read_text())
            data["failed_delivery_until"] = self.now
            path.write_text(json.dumps(data))
        self.dispatch([], load=13, go=True)
        self.assertTrue(own.exists())
        self.comments["HTPR-1"] = [claim("RUNNER 1")]
        self.ready_go()
        self.assertEqual(self.dispatch(self.rows[:1], go=True)[0]["ticket"], "YPER4-1")
        self.assertFalse(own.exists())
        self.assertTrue(other.exists())
        self.assertTrue(active.exists())

    def test_go_sends_exact_sequence_logs_and_remembers_cooldown(self):
        self.ready_go()
        result = self.dispatch(self.rows[:1], go=True)
        self.assertEqual(result[0]["action"], "sent")
        sent = [c.args for c in self.commands.call_args_list if "send-keys" in c.args]
        self.assertEqual(sent, [("tmux", "send-keys", "-t", "%1", "-l", "/clear"),
                               ("tmux", "send-keys", "-t", "%1", "Enter"),
                               ("tmux", "send-keys", "-t", "%1", "-l", "/ship HTPR-1"),
                               ("tmux", "send-keys", "-t", "%1", "Enter")])
        self.assertEqual([c.args for c in self.sleep.call_args_list], [(3,), (1,)])
        self.assertIn("RUNNER 1 before=123k HTPR-1 auto\n", (self.state / "fresh-session-trial.log").read_text())
        entry = json.loads((self.loop / "dispatch.log").read_text())
        self.assertEqual((entry["ticket"], entry["before"]), ("HTPR-1", "123k"))
        self.assertEqual(json.loads((self.loop / "last-dispatch.json").read_text()), {"%1": self.now})
        self.assertTrue((self.claim_dir / "HTPR-1.json").exists())
        self.assertIsNone(self.dispatch(self.rows[:1], go=True)[0]["ticket"])

    def test_cleanup_only_own_done_claims_and_only_go(self):
        self.boards[15][0]["section"] = "Done"
        self.boards[15][1]["section"] = "Done"
        own = self.file_claim("HTPR-1")
        other = self.file_claim("HTPR-2", "Mini Boss CEO")
        active = self.file_claim("HTPR-4")
        self.dispatch(rows=[])
        self.assertTrue(own.exists())
        self.dispatch(rows=[], go=True)
        self.assertFalse(own.exists())
        self.assertTrue(other.exists())
        self.assertTrue(active.exists())

    def test_comment_pagination_stale_has_more_flag(self):
        self.commands.side_effect = [json.dumps({"success": True, "comments": [claim("Runner 1")],
                                                "total": 2, "nextCursor": "older", "has_more": True}),
                                    json.dumps({"success": True, "comments": [claim("Runner 2")],
                                                "total": 2, "nextCursor": None, "has_more": True})]
        comments = m.pages(("hypertask", "comment", "list", "HTPR-4", "--limit", "50", "--json"), "comments")
        self.assertEqual(len(comments), 2)
        self.assertEqual(self.commands.call_args.args[-2:], ("--cursor", "older"))
        self.commands.side_effect = None
        self.commands.return_value = json.dumps({"success": True, "comments": [], "total": 1})
        with self.assertRaises(ValueError):
            m.pages(("hypertask", "comment", "list", "HTPR-4"), "comments")

    def test_paginated_reads_and_comment_scope_cache(self):
        calls = []
        def api(*args):
            calls.append(args)
            self.assertEqual(args[0], "hypertask")
            if args[1:3] == ("tasks", "list"):
                if "--cursor" not in args:
                    return json.dumps({"success": True, "tasks": [self.boards[15][0]],
                                       "total": 2, "nextCursor": "second"})
                return json.dumps({"success": True, "tasks": [self.boards[15][1]], "total": 2})
            self.assertEqual(args[1:3], ("comment", "list"))
            return json.dumps({"success": True, "comments": [], "total": 0})
        self.commands.side_effect = api
        boards = m.read_boards()
        self.assertEqual(len(boards[4060]), 2)
        self.assertTrue(all("500" in c for c in calls))
        calls.clear()
        self.boards[15].extend([dict(self.boards[15][0]),
                               {"ticketNumber":"HTPR-99", "section":"Done"},
                               {"ticketNumber":"HTPR-98", "section":"Valentin Review"}])
        cache = m.read_comments(self.boards)
        self.assertEqual(set(cache), set(self.comments))
        self.assertEqual(len(calls), len(cache))
        self.assertTrue(all(c[-3:] == ("--limit", "50", "--json") for c in calls))


if __name__ == "__main__":
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(DispatchTests))
    if not result.wasSuccessful():
        raise SystemExit(1)
    print("ALL PASS")
