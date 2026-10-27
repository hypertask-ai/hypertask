#!/usr/bin/env python3
"""JSON fixture tests; external commands and sleeps are always mocked."""
import contextlib
import io
import importlib.machinery
import importlib.util
import json
import os
import subprocess
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

SOURCE = Path(os.environ.get("DISPATCH_TEST_SOURCE", Path(__file__).with_name("runner-dispatch")))
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
        self.live_reader = getattr(m, "live_claude", None)
        self.live = patch.object(m, "live_claude", return_value=True, create=True).start()
        self.metrics_reader = m.session_metrics
        self.metrics = patch.object(m, "session_metrics", return_value=None).start()

    def test_blocked_markers_are_not_free_even_in_pickable_columns(self):
        for board in (15, 4060):
            for field, value in (("blockerCommentId", 123), ("waitingOnUserId", 6), ("waitingOnAgentId", "lead-agent")):
                with self.subTest(board=board, field=field):
                    task = self.boards[board][0]
                    task[field] = value
                    self.assertNotIn(task["ticketNumber"], m.free_tickets(self.boards, self.comments, self.claim_dir))
                    task[field] = None
                    self.assertIn(task["ticketNumber"], m.free_tickets(self.boards, self.comments, self.claim_dir))

    def test_blocked_columns_are_not_pickable(self):
        for board, blocked, available in ((15, "Agent Blocked (Infra)", "Bugs"),
                                          (4060, "Agent Blocked", "Backlog")):
            for section in (blocked, "Blocked", "Valentin Review"):
                with self.subTest(board=board, section=section):
                    task = self.boards[board][0]
                    task["section"] = section
                    self.assertNotIn(task["ticketNumber"], m.free_tickets(self.boards, self.comments, self.claim_dir))
                    task["section"] = available
                    self.assertIn(task["ticketNumber"], m.free_tickets(self.boards, self.comments, self.claim_dir))

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

    def safe_runner(self, context=90_000, state="waiting_bg", runner="RUNNER 8"):
        row = dict(runner=runner, pane="%8", state=state, input_box="empty", spinner=False)
        for task in self.boards[15][:3]:
            task["section"] = "In Progress"
            ticket = task["ticketNumber"]
            at = m.datetime.fromtimestamp(self.now - 10, m.timezone.utc).isoformat()
            note = "Next: finish QA\nHelpers: helper-123\nBranch/PR: yper4-448 / PR 123\nOutputs: /tmp/helper-123.txt"
            self.comments[ticket] = [claim(runner), claim(runner, at, note)]
        self.metrics.return_value = dict(session="session-1", context=context, activity=self.now - 20,
                                         usage_at=self.now - 15, cleared=0, started=self.now - 60)
        self.ready_go([row])
        return row

    def sent_texts(self):
        return [c.args[-1] for c in self.commands.call_args_list if "-l" in c.args]

    def clear_records(self):
        return json.loads((self.loop / "runner-clear.json").read_text())

    def test_three_held_waiting_bg_90k_fresh_state_clears_and_resumes_all(self):
        row = self.safe_runner()
        with contextlib.redirect_stderr(io.StringIO()) as log:
            result = self.dispatch([row], go=True)
        self.assertEqual(self.sent_texts(), ["/clear", "resume: read your held tickets' latest comments: HTPR-1, HTPR-2, HTPR-3"])
        self.assertEqual(result[0]["action"], "cleared")
        self.assertEqual(self.clear_records()[row["runner"]]["last_clear"], self.now)
        self.assertEqual(log.getvalue().count("cleared RUNNER 8 reason=context_80k context=90000"), 1)
        self.assertFalse((self.loop / "last-dispatch.json").exists())

    def test_waiting_only_holdings_require_every_checkpoint_before_clear(self):
        row = self.safe_runner(state="waiting_valentin")
        self.boards[15][0]["section"] = "Valentin Review"
        self.boards[15][1]["section"] = "UX Sign-off"
        self.boards[15][2]["section"] = "Done"
        for ticket in ("HTPR-1", "HTPR-2"):
            with self.subTest(ticket=ticket):
                checkpoint = self.comments[ticket].pop()
                self.dispatch([row], go=True)
                self.assertEqual(self.sent_texts(), [])
                self.comments[ticket].append(checkpoint)
        self.dispatch([row], go=True)
        self.assertEqual(self.sent_texts(), ["/clear", "resume: read your held tickets' latest comments: HTPR-1, HTPR-2"])

    def test_blocked_holdings_require_checkpoints_and_appear_in_resume(self):
        row = self.safe_runner()
        self.boards[15][0]["section"] = "Agent Blocked (Infra)"
        self.boards[15][1]["section"] = "Done"
        self.boards[15][2]["section"] = "Done"
        self.boards[4060][0]["section"] = "Agent Blocked"
        self.comments["YPER4-1"] = list(self.comments["HTPR-1"])
        for ticket in ("HTPR-1", "YPER4-1"):
            with self.subTest(ticket=ticket):
                checkpoint = self.comments[ticket].pop()
                self.dispatch([row], go=True)
                self.assertEqual(self.sent_texts(), [])
                self.comments[ticket].append(checkpoint)
        self.dispatch([row], go=True)
        self.assertEqual(self.sent_texts(), ["/clear", "resume: read your held tickets' latest comments: HTPR-1, YPER4-1"])

    def test_blocked_comments_are_read_for_checkpoint_protection(self):
        self.boards[15][0]["section"] = "Agent Blocked (Infra)"
        self.boards[4060][0]["section"] = "Agent Blocked"
        with patch.object(m, "pages", return_value=[]) as pages:
            comments = m.read_comments(self.boards)
        for ticket in ("HTPR-1", "YPER4-1"):
            self.assertIn(ticket, comments)
            self.assertTrue(any(ticket in call.args[0] for call in pages.call_args_list))

    def test_active_and_waiting_holdings_all_appear_in_resume(self):
        row = self.safe_runner()
        self.boards[15][1]["section"] = "Valentin Review"
        self.boards[15][2]["section"] = "UX Sign-off"
        self.dispatch([row], go=True)
        self.assertEqual(self.sent_texts(), ["/clear", "resume: read your held tickets' latest comments: HTPR-1, HTPR-2, HTPR-3"])

    def test_all_clearable_states_require_context_above_80k(self):
        for state in ("idle", "waiting_bg", "done", "waiting_valentin"):
            for context in (None, 30_000, 80_000):
                with self.subTest(state=state, context=context):
                    row = self.safe_runner(context=context, state=state)
                    self.dispatch([row], go=True)
                    self.assertEqual(self.sent_texts(), [])
            with self.subTest(state=state, context=80_001):
                row = self.safe_runner(context=80_001, state=state)
                self.dispatch([row], go=True)
                self.assertEqual(self.sent_texts()[0], "/clear")
                self.commands.reset_mock()
                (self.loop / "runner-clear.json").unlink()

    def test_one_held_ticket_without_fresh_state_prevents_clear(self):
        row = self.safe_runner()
        for invalid in ([], [claim(row["runner"])],
                        [claim("RUNNER 2", m.datetime.fromtimestamp(self.now, m.timezone.utc).isoformat(),
                               "Next: QA\nHelpers: none\nBranch/PR: none\nOutputs: none")]):
            with self.subTest(invalid=invalid):
                self.comments["HTPR-2"] = invalid
                # Keep the claim: only the checkpoint is absent or stale.
                self.comments["HTPR-2"].insert(0, claim(row["runner"]))
                self.dispatch([row], go=True)
                self.assertEqual(self.sent_texts(), [])

    def test_unsent_input_never_clears_even_at_high_context(self):
        row = self.safe_runner()
        for box in ("typed", None):
            for fresh_only in (False, True):
                with self.subTest(box=box, fresh_only=fresh_only):
                    typed = dict(row, input_box=box)
                    with patch.object(m, "snapshots", return_value=[typed]):
                        self.dispatch([row if fresh_only else typed], go=True)
                    self.assertEqual(self.sent_texts(), [])

    def test_shell_only_panes_skip_alarm_and_clear(self):
        row = self.safe_runner(context=160_000)
        self.metrics.return_value["started"] = self.now - m.ALARM_EVERY
        self.live.return_value = False
        self.dispatch([row], go=True)
        self.assertFalse((self.state / "runner-inbox").exists())
        self.assertFalse((self.loop / "runner-clear.json").exists())
        self.assertEqual(self.sent_texts(), [])
        self.metrics.assert_not_called()

    def test_live_claude_checks_pane_root_and_descendants_not_stale_ui(self):
        self.commands.side_effect = None
        self.commands.return_value = "%4\t100\n%6\t600\n"
        row = dict(runner="RUNNER 4", pane="%4", claude_alive=True)
        for root, children, grandchild, expected in (
                ("100 1 S bash", "", "", False),
                ("100 1 S bash", "101 100 S bash", "102 101 S claude", True),
                ("100 1 S claude", "", "", True),
                ("100 1 S bash", "101 100 Z claude", "", False),
                ("100 1 S bash", "101 100 S hax", "", False)):
            with self.subTest(root=root, children=children, expected=expected):
                replies = [types.SimpleNamespace(returncode=0, stdout=root + "\n" + children, stderr=""),
                           types.SimpleNamespace(returncode=0 if grandchild else 1, stdout=grandchild, stderr=""),
                           types.SimpleNamespace(returncode=1, stdout="", stderr="")]
                with patch.object(m.subprocess, "run", side_effect=replies):
                    self.assertEqual(self.live_reader(row), expected)
        with patch.object(m.subprocess, "run", side_effect=OSError("ps unavailable")):
            self.assertFalse(self.live_reader(row))
        self.commands.return_value = "%6\t600\n"
        self.assertFalse(self.live_reader(row))

    def test_external_clear_session_change_and_usage_drop_persist_once(self):
        for runner in ("RUNNER 3", "SPEED RUNNER"):
            for signal in ("session", "drop", "explicit"):
                with self.subTest(runner=runner, signal=signal):
                    row = self.safe_runner(context=100_000, state="busy", runner=runner)
                    path = self.loop / "runner-clear.json"
                    path.unlink(missing_ok=True)
                    self.dispatch([row], go=True)
                    baseline = self.clear_records()[runner]
                    self.assertEqual(baseline["last_clear"], 0)
                    self.now += 60
                    if signal == "session":
                        self.metrics.return_value.update(session="session-2", context=None, usage_at=0)
                        cleared_at = self.now
                    elif signal == "drop":
                        self.metrics.return_value.update(context=29_999, usage_at=self.now - 5)
                        cleared_at = self.now - 5
                    else:
                        self.metrics.return_value.update(cleared=self.now - 5, context=None, usage_at=0)
                        cleared_at = self.now - 5
                    with contextlib.redirect_stderr(io.StringIO()) as log:
                        self.dispatch([row], go=True)
                        self.now += 60
                        self.dispatch([row], go=True)
                    record = self.clear_records()[runner]
                    self.assertEqual(record["last_clear"], cleared_at)
                    self.assertEqual(record.get("reason"), "external")
                    self.assertEqual(record["session"], self.metrics.return_value["session"])
                    if signal == "drop":
                        self.assertEqual(record["context"], 29_999)
                    self.assertEqual(log.getvalue().count(f"cleared {runner} reason=external"), 1)
        self.assertEqual(self.sent_texts(), [])

    def test_external_clear_drop_requires_new_usage_and_strict_threshold(self):
        row = self.safe_runner(context=100_000, state="busy")
        self.dispatch([row], go=True)
        old_at = self.metrics.return_value["usage_at"]
        for context, at in ((29_999, old_at), (30_000, old_at + 1), (None, 0)):
            with self.subTest(context=context, at=at):
                self.metrics.return_value.update(context=context, usage_at=at)
                self.dispatch([row], go=True)
                self.assertEqual(self.clear_records()[row["runner"]]["last_clear"], 0)

    def test_external_clear_migrates_numeric_state_without_resetting_alarm_throttle(self):
        row = self.safe_runner(context=50_000, state="busy", runner="RUNNER 3")
        self.loop.mkdir()
        path = self.loop / "runner-clear.json"
        path.write_text(json.dumps({"RUNNER 3": {"first_seen": self.now - 100_000,
                                                 "last_clear": 0, "last_alarm": self.now - 10}}))
        self.dispatch([row], go=True)
        record = self.clear_records()["RUNNER 3"]
        self.assertEqual(record["last_clear"], self.metrics.return_value["started"])
        self.assertEqual(record.get("reason"), "external")
        self.assertEqual(record["last_alarm"], self.now - 10)
        self.assertFalse((self.state / "runner-inbox").exists())
        # The migrated record must remain readable on subsequent ticks.
        self.dispatch([row], go=True)
        self.assertEqual(self.clear_records()["RUNNER 3"], record)

    def test_dispatch_clear_new_session_is_not_counted_again_as_external(self):
        row = self.safe_runner()
        self.dispatch([row], go=True)
        cleared_at = self.now
        self.now += 60
        self.metrics.return_value.update(session="session-2", context=1000,
                                         started=self.now - 50, usage_at=self.now - 5)
        with contextlib.redirect_stderr(io.StringIO()) as log:
            self.dispatch([row], go=True)
        record = self.clear_records()[row["runner"]]
        self.assertEqual(record["last_clear"], cleared_at)
        self.assertEqual(record["reason"], "context_80k")
        self.assertNotIn("reason=external", log.getvalue())

    def test_never_cleared_six_hours_alarm_fires_once_per_six_hours(self):
        row = self.safe_runner(context=50_000, state="busy")
        self.metrics.return_value["started"] = self.now - m.ALARM_EVERY
        with contextlib.redirect_stderr(io.StringIO()) as log:
            self.dispatch([row], go=True)
            self.now += m.ALARM_EVERY - 1
            self.dispatch([row], go=True)
            inbox = self.state / "runner-inbox/infra-manager.events.jsonl"
            self.assertEqual(len(inbox.read_text().splitlines()), 1)
            self.now += 1
            self.dispatch([row], go=True)
        events = [json.loads(line) for line in inbox.read_text().splitlines()]
        self.assertEqual(len(events), 2)
        self.assertTrue(all(not e["delivered"] and "no_clear_6h" in e["text"] for e in events))
        self.assertIn('"delivered":false', inbox.read_text())
        self.assertEqual(log.getvalue().count("alarm RUNNER 8"), 2)
        self.assertEqual(self.sent_texts(), [])

    def test_160k_context_alarms_without_waiting_six_hours(self):
        row = self.safe_runner(context=160_000, state="busy")
        with contextlib.redirect_stderr(io.StringIO()) as log:
            self.dispatch([row], go=True)
            self.dispatch([row], go=True)
        events = (self.state / "runner-inbox/infra-manager.events.jsonl").read_text().splitlines()
        self.assertEqual(len(events), 1)
        self.assertIn("alarm RUNNER 8 reason=context_150k context=160000", log.getvalue())
        self.assertEqual(self.clear_records()[row["runner"]]["last_alarm"], self.now)

    def test_self_pulled_ticket_clears_without_dispatch_history_or_claim_file(self):
        row = self.safe_runner(context=90_000)
        self.assertFalse(self.claim_dir.exists())
        self.assertFalse(self.loop.exists())
        self.dispatch([row], go=True)
        self.assertEqual(self.sent_texts()[0], "/clear")
        self.assertFalse(self.claim_dir.exists())
        self.assertFalse((self.loop / "last-dispatch.json").exists())

    def test_maintenance_dry_run_has_no_reads_writes_or_sends(self):
        row = self.safe_runner()
        self.dispatch([row])
        self.metrics.assert_not_called()
        self.commands.assert_not_called()
        self.assertEqual(list(self.state.iterdir()), [])

    def test_checkpoint_requires_all_fields_external_outputs_and_current_runner(self):
        row = self.safe_runner()
        good = self.comments["HTPR-1"][-1]
        for text in ("Next: QA", good["text"].replace("/tmp/helper-123.txt", "only in context"),
                     good["text"].replace("Helpers: helper-123", "Helpers:")):
            with self.subTest(text=text):
                self.assertFalse(m.current_checkpoint("HTPR-1", row["runner"],
                                 {"HTPR-1": [dict(good, text=text)]}, self.now - 20))
        self.assertTrue(m.current_checkpoint("HTPR-1", row["runner"], self.comments, self.now - 20))
        self.assertFalse(m.current_checkpoint("HTPR-1", row["runner"], self.comments, self.now))

    def test_checkpoint_html_inline_labels_and_newer_comment_invalidate_old_state(self):
        row = self.safe_runner()
        good = dict(self.comments["HTPR-1"][-1])
        good["text"] = "".join(f"<p><strong>{line.split(':', 1)[0]}:</strong>{line.split(':', 1)[1]}</p>"
                               for line in good["text"].splitlines())
        comments = {"HTPR-1": [good]}
        self.assertTrue(m.current_checkpoint("HTPR-1", row["runner"], comments, self.now - 20))
        later = claim(row["runner"], m.datetime.fromtimestamp(self.now - 5, m.timezone.utc).isoformat(),
                      "Helper output was lost; state above is no longer current")
        comments["HTPR-1"].append(later)
        self.assertFalse(m.current_checkpoint("HTPR-1", row["runner"], comments, self.now - 20))

    def test_changed_tool_activity_or_busy_pane_prevents_clear(self):
        row = self.safe_runner()
        with patch.object(m, "snapshots", return_value=[dict(row, state="busy")]):
            self.dispatch([row], go=True)
        self.assertEqual(self.sent_texts(), [])
        self.metrics.side_effect = [self.metrics.return_value, dict(self.metrics.return_value, activity=self.now)]
        self.dispatch([row], go=True)
        self.assertEqual(self.sent_texts(), [])

    def test_clear_does_not_repeat_on_same_checkpoint_or_clear_on_finished_ticket(self):
        row = self.safe_runner()
        self.dispatch([row], go=True)
        self.now += 900
        self.dispatch([row], go=True)
        self.assertEqual(self.sent_texts().count("/clear"), 1)
        self.metrics.return_value = None
        self.commands.reset_mock()
        self.ready_go()
        self.dispatch(self.rows[:1], go=True)
        self.assertNotIn("/clear", self.sent_texts())

    def test_resume_guard_preserves_input_typed_after_clear(self):
        row = self.safe_runner()
        with patch.object(m, "snapshots", side_effect=[[row], [dict(row, state="typed", input_box="typed")]]):
            with contextlib.redirect_stderr(io.StringIO()) as log:
                self.dispatch([row], go=True)
        self.assertEqual(self.sent_texts(), ["/clear"])
        self.assertIn("resume withheld", log.getvalue())
        self.assertEqual(self.clear_records()[row["runner"]]["last_clear"], self.now)

    def transcript_fixture(self, events):
        home = self.state / "home"
        registry = home / ".claude/sessions"
        registry.mkdir(parents=True, exist_ok=True)
        session = dict(sessionId="session-1", cwd="/repo.example", startedAt=(self.now - 100) * 1000,
                       tmux="hypertask:@1.%8", name="RUNNER 8 | tickets")
        (registry / "123.json").write_text(json.dumps(session))
        project = home / ".claude/projects/-repo-example"
        project.mkdir(parents=True, exist_ok=True)
        path = project / "session-1.jsonl"
        path.write_text("".join(json.dumps(e) + "\n" for e in events))
        return home, path

    def event(self, seconds, kind="assistant", content=None, **extra):
        return dict(type=kind, timestamp=m.datetime.fromtimestamp(self.now + seconds, m.timezone.utc).isoformat(),
                    sessionId="session-1", message=dict(content=content or []), **extra)

    def test_local_transcript_uses_latest_input_and_caches_not_cumulative_or_helpers(self):
        first = self.event(-30)
        first["message"]["usage"] = dict(input_tokens=10, cache_creation_input_tokens=100_000)
        latest = self.event(-10, content=[dict(type="tool_use", id="t1", name="Read", input={})])
        latest["message"]["usage"] = dict(input_tokens=1000, cache_creation_input_tokens=9000,
                                          cache_read_input_tokens=80_000, output_tokens=5000)
        helper = self.event(-5, isSidechain=True)
        helper["message"]["usage"] = dict(input_tokens=200_000)
        result = self.event(-9, "user", [dict(type="tool_result", tool_use_id="t1")])
        home, path = self.transcript_fixture([first, latest, result, helper])
        metrics = self.metrics_reader(dict(runner="RUNNER 8", pane="%8"), home)
        self.assertEqual(metrics["context"], 90_000)
        self.assertEqual(metrics["activity"], self.now - 9)
        self.assertEqual(metrics["started"], self.now - 100)
        self.assertEqual(metrics["cleared"], 0)

    def test_local_transcript_comment_only_writes_allow_multi_ticket_checkpoints(self):
        events = [self.event(-40, content=[dict(type="tool_use", name="Write", id="work", input={})]),
                  self.event(-39, "user", [dict(type="tool_result", tool_use_id="work")])]
        for n in range(3):
            events.extend([self.event(-30 + n * 2, content=[dict(type="tool_use", name="Bash", id=f"c{n}",
                           input=dict(command=f"vcc comment add HTPR-{n} --text 'Next: QA'"))]),
                           self.event(-29 + n * 2, "user", [dict(type="tool_result", tool_use_id=f"c{n}")])])
        home, path = self.transcript_fixture(events)
        row = dict(runner="RUNNER 8", pane="%8")
        self.assertEqual(self.metrics_reader(row, home)["activity"], self.now - 39)
        events.append(self.event(-10, content=[dict(type="tool_use", name="Bash", id="batch",
                      input=dict(command="vcc comment add HTPR-1 --text note; touch /tmp/result"))]))
        self.transcript_fixture(events)
        self.assertEqual(self.metrics_reader(row, home)["activity"], self.now - 10)

    def test_multiline_quoted_checkpoint_write_and_result_do_not_stale_checkpoint(self):
        row = self.safe_runner()
        checkpoint = self.comments["HTPR-1"][-1]["text"]
        events = [self.event(-40, content=[dict(type="tool_use", name="Write", id="work", input={})]),
                  self.event(-39, "user", [dict(type="tool_result", tool_use_id="work")])]
        for n, executable in enumerate(("vcc", "hypertask")):
            events.extend([self.event(-12 + n * 4, content=[dict(type="tool_use", name="Bash", id=f"c{n}",
                           input=dict(command=f'{executable} comment add HTPR-1 --text "{checkpoint}\nQA; ready & waiting | review"'))]),
                           self.event(-9 + n * 4, "user", [dict(type="tool_result", tool_use_id=f"c{n}")])])
        events[-2]["message"]["usage"] = dict(input_tokens=90_000)
        home, path = self.transcript_fixture(events)
        self.metrics.return_value = self.metrics_reader(row, home)
        self.assertEqual(self.metrics.return_value["activity"], self.now - 39)
        self.dispatch([row], go=True)
        self.assertEqual(self.sent_texts()[0], "/clear")

    def test_unquoted_shell_operators_in_checkpoint_command_count_as_activity(self):
        row = dict(runner="RUNNER 8", pane="%8")
        for operator in (";", "&&", "||", "|", "&", "\n", ">", "$(touch /tmp/result)", "`touch /tmp/result`"):
            with self.subTest(operator=operator):
                event = self.event(-10, content=[dict(type="tool_use", name="Bash", id="batch",
                                   input=dict(command=f"vcc comment add HTPR-1 --text note {operator} touch /tmp/result"))])
                result = self.event(-9, "user", [dict(type="tool_result", tool_use_id="batch")])
                home, path = self.transcript_fixture([event, result])
                self.assertEqual(self.metrics_reader(row, home)["activity"], self.now - 9)

    def test_local_transcript_clear_and_compaction_reset_stale_usage(self):
        usage = self.event(-40)
        usage["message"]["usage"] = dict(input_tokens=160_000)
        clear = self.event(-20, "user")
        clear["message"]["content"] = "<command-name>/clear</command-name>"
        row = dict(runner="RUNNER 8", pane="%8")
        for boundary in (clear, self.event(-20, "system", subtype="compact_boundary")):
            with self.subTest(boundary=boundary):
                home, path = self.transcript_fixture([usage, boundary])
                metrics = self.metrics_reader(row, home)
                self.assertIsNone(metrics["context"])
                self.assertEqual(metrics["usage_at"], 0)
                self.assertEqual(metrics["cleared"], self.now - 20 if boundary is clear else 0)

    def test_local_transcript_bounded_tail_unknown_or_malformed_fails_closed(self):
        event = self.event(-10)
        event["message"]["usage"] = dict(input_tokens=90_000)
        home, path = self.transcript_fixture([event])
        # A long invalid prefix must never be parsed or read as a complete transcript.
        path.write_bytes(b"x" * (m.SESSION_TAIL + 100) + b"\n" + path.read_bytes())
        row = dict(runner="RUNNER 8", pane="%8")
        self.assertEqual(self.metrics_reader(row, home)["context"], 90_000)
        self.assertEqual(self.metrics_reader(row, home)["activity"], 0)
        self.assertIsNone(self.metrics_reader(dict(row, pane="%9"), home))
        path.write_text('{"partial":')
        self.assertIsNone(self.metrics_reader(row, home)["context"])
        self.assertEqual(self.metrics_reader(row, home)["activity"], 0)
        path.unlink()
        self.assertEqual(self.metrics_reader(row, home)["started"], self.now - 100)
        self.assertIsNone(self.metrics_reader(row, home)["context"])

    def test_observed_manual_clear_persists_and_suppresses_old_age_alarm(self):
        row = self.safe_runner(context=50_000, state="busy")
        self.metrics.return_value.update(started=self.now - 100_000, cleared=self.now - 10)
        self.dispatch([row], go=True)
        self.assertEqual(self.clear_records()[row["runner"]]["last_clear"], self.now - 10)
        self.assertFalse((self.state / "runner-inbox").exists())
        self.metrics.return_value["cleared"] = 0  # Boundary fell outside bounded tail.
        self.dispatch([row], go=True)
        self.assertEqual(self.clear_records()[row["runner"]]["last_clear"], self.now - 10)

    def test_alarm_queue_preserves_existing_events_and_deduplicates_retry(self):
        inbox = self.state / "runner-inbox"
        inbox.mkdir()
        path = inbox / "infra-manager.events.jsonl"
        existing = dict(id="old", ts=self.now - 1, text="existing", delivered=False)
        path.write_text(json.dumps(existing) + "\n")
        for unused in range(2):
            m.queue_clear_alarm(self.state, "RUNNER 8", "alarm RUNNER 8", self.now)
        events = [json.loads(line) for line in path.read_text().splitlines()]
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0], existing)
        self.assertEqual(events[1]["text"], "alarm RUNNER 8")
        self.assertEqual(list(inbox.glob("*.tmp.*")), [])

    def test_alarm_inbox_throttle_survives_lost_state_and_time_bucket_change(self):
        row = self.safe_runner(context=160_000, state="busy")
        self.now = (self.now // m.ALARM_EVERY + 1) * m.ALARM_EVERY - 10
        with contextlib.redirect_stderr(io.StringIO()) as log:
            self.dispatch([row], go=True)
            (self.loop / "runner-clear.json").unlink()
            self.now += 20
            self.dispatch([row], go=True)
        inbox = self.state / "runner-inbox/infra-manager.events.jsonl"
        self.assertEqual(len(inbox.read_text().splitlines()), 1)
        self.assertEqual(log.getvalue().count("alarm RUNNER 8"), 1)

    def test_missing_transcript_still_allows_age_alarm_not_clear(self):
        home, path = self.transcript_fixture([])
        path.unlink()
        metrics = self.metrics_reader(dict(runner="RUNNER 8", pane="%8"), home)
        metrics["started"] = self.now - m.ALARM_EVERY
        self.metrics.return_value = metrics
        row = dict(runner="RUNNER 8", pane="%8", state="idle", input_box="empty")
        self.ready_go([row])
        self.dispatch([row], go=True)
        self.assertEqual(self.sent_texts(), [])
        event = json.loads((self.state / "runner-inbox/infra-manager.events.jsonl").read_text())
        self.assertIn("no_clear_6h", event["text"])

    def test_corrupt_clear_state_blocks_clear_and_alarm_without_overwrite(self):
        row = self.safe_runner(context=160_000)
        self.loop.mkdir()
        path = self.loop / "runner-clear.json"
        for raw in ('{"broken":', '[]', '{"RUNNER 8":{"last_alarm":"bad"}}',
                    '{"RUNNER 8":{"session":7}}', '{"RUNNER 8":{"reason":false}}',
                    '{"RUNNER 8":{"context":-1}}'):
            with self.subTest(raw=raw), contextlib.redirect_stderr(io.StringIO()) as log:
                path.write_text(raw)
                self.dispatch([row], go=True)
                self.assertEqual(path.read_text(), raw)
                self.assertEqual(self.sent_texts(), [])
                self.assertIn("maintenance skipped", log.getvalue())
                self.assertFalse((self.state / "runner-inbox").exists())

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

    def test_speed_active_holds_block_ticket_and_research_before_claim(self):
        self.comments["HTPR-4"] = [claim("Speed Runner")]
        self.ready_go()
        for state in ("idle", "waiting_valentin"):
            for speed_ticket in (False, True):
                self.boards[15] = [t for t in self.boards[15] if t["ticketNumber"] != "HTPR-9"]
                if speed_ticket:
                    self.add_speed_ticket()
                for go in (False, True):
                    with self.subTest(state=state, speed_ticket=speed_ticket, go=go):
                        with patch.object(m, "acquire_claim", wraps=m.acquire_claim) as acquire:
                            result = self.dispatch([dict(self.rows[8], state=state)], go=go)[0]
                        self.assertEqual(result["held"], ["HTPR-4"])
                        self.assertIsNone(result["ticket"])
                        acquire.assert_not_called()
                        self.commands.assert_not_called()
                        self.assertEqual(list(self.state.iterdir()), [])

    def test_fresh_active_holds_abort_and_release_unsent_claim(self):
        self.add_speed_ticket()
        for row in (self.rows[0], self.rows[8]):
            self.comments["HTPR-4"] = [claim(row["runner"])]
            for state in (("idle",) if row["runner"] != m.SPEED else ("idle", "waiting_valentin")):
                with self.subTest(runner=row["runner"], state=state):
                    self.ready_go([dict(row, state=state)])
                    self.commands.reset_mock()
                    result = self.dispatch([row], go=True)[0]
                    self.assertIsNone(result["ticket"])
                    self.assertEqual(result["state"], state)
                    self.assertFalse(any("send-keys" in c.args for c in self.commands.call_args_list))
                    self.assertEqual(list(self.claim_dir.glob("*.json")), [])
                    self.assertFalse((self.loop / "last-dispatch.json").exists())

    def test_speed_done_with_stale_hold_still_dispatches(self):
        self.add_speed_ticket()
        self.comments["HTPR-4"] = [claim(m.SPEED)]
        self.ready_go()
        self.assertEqual(self.dispatch(self.rows[8:], go=True)[0]["ticket"], "HTPR-9")

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

    def test_malformed_dispatch_state_is_empty_with_one_log_line(self):
        self.loop.mkdir()
        path = self.loop / "last-dispatch.json"
        for raw in ('{"%1":', '[]', 'null', '{"%1":"bad"}', '{"%1":true}',
                    '{"%1":NaN}', '{"%1":Infinity}'):
            with self.subTest(raw=raw):
                path.write_text(raw)
                stderr = io.StringIO()
                with contextlib.redirect_stderr(stderr):
                    self.assertEqual(self.dispatch(self.rows[:1])[0]["ticket"], "HTPR-1")
                self.assertEqual(stderr.getvalue().splitlines(), [
                    "runner-dispatch: malformed last-dispatch.json; using empty state"])
                self.assertEqual(path.read_text(), raw)
        path.unlink()
        with contextlib.redirect_stderr(io.StringIO()) as stderr:
            self.assertEqual(m.read_last(self.loop), {})
        self.assertEqual(stderr.getvalue(), "")

    def test_dispatch_state_replaced_atomically_for_normal_speed_and_research(self):
        self.add_speed_ticket()
        self.loop.mkdir()
        path = self.loop / "last-dispatch.json"
        replace = os.replace
        for row, ticket in ((self.rows[0], "HTPR-1"), (self.rows[8], "HTPR-9"),
                            (self.rows[8], "research")):
            with self.subTest(ticket=ticket):
                if ticket == "research":
                    self.boards[15] = [t for t in self.boards[15] if t["ticketNumber"] != "HTPR-9"]
                path.write_text('{"truncated":')
                self.ready_go()
                replacements = []
                def check_replace(source, target):
                    if target == path:
                        self.assertEqual(path.read_text(), '{"truncated":')
                        self.assertEqual(source.parent, path.parent)
                        self.assertNotEqual(source, target)
                        expected = {row["pane"]: self.now}
                        if ticket == "research":
                            expected["speed-research"] = self.now
                        self.assertEqual(json.loads(source.read_text()), expected)
                        replacements.append(target)
                    replace(source, target)
                with patch.object(m.os, "replace", side_effect=check_replace), \
                        contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(self.dispatch([row], go=True)[0]["action"], "sent")
                self.assertEqual(replacements, [path])
                self.assertEqual(json.loads(path.read_text())[row["pane"]], self.now)
                self.assertEqual(list(self.loop.glob("*.tmp.*")), [])

    def test_clear_and_dispatch_state_use_shared_atomic_json_writer(self):
        row = self.safe_runner()
        with patch.object(m, "write_json", wraps=m.write_json) as writer:
            self.dispatch([row], go=True)
            self.assertTrue(writer.call_args_list)
            self.assertTrue(all(call.args[0] == self.loop / "runner-clear.json"
                                for call in writer.call_args_list))
        self.metrics.return_value = None
        self.ready_go()
        with patch.object(m, "write_json", wraps=m.write_json) as writer:
            self.dispatch(self.rows[:1], go=True)
            writer.assert_called_once_with(self.loop / "last-dispatch.json", {"%1": self.now})
        self.assertEqual(list(self.loop.glob("*.tmp.*")), [])

    def test_dispatch_state_write_failure_preserves_old_state_and_cleans_temp(self):
        self.loop.mkdir()
        path = self.loop / "last-dispatch.json"
        old = '{"%1": 123}\n'
        path.write_text(old)
        write_text = Path.write_text
        def partial_write(target, text, *args, **kwargs):
            write_text(target, text[:3], *args, **kwargs)
            raise OSError("partial write")
        for failure in ("write", "replace"):
            with self.subTest(failure=failure):
                if failure == "write":
                    mocked = patch.object(Path, "write_text", partial_write)
                else:
                    mocked = patch.object(m.os, "replace", side_effect=OSError("replace failed"))
                with mocked, self.assertRaises(OSError):
                    m.write_json(path, {"%1": self.now})
                self.assertEqual(path.read_text(), old)
                self.assertEqual(list(self.loop.glob("*.tmp.*")), [])

    def test_review_fix_mutations_are_killed(self):
        source = SOURCE.read_text()
        mutants = [
            ("speed_hold", 'row["state"] not in SPEED_STATES\n                    or blocking',
             'row["state"] not in SPEED_STATES', "test_speed_active_holds_block_ticket_and_research_before_claim", 1),
            ("waiting_hold", 'blocking = holding if row["state"] != "done" else []',
             'blocking = holding if row["state"] == "idle" else []',
             "test_speed_active_holds_block_ticket_and_research_before_claim", 1),
            ("fresh_speed_hold", 'fresh[0]["state"] not in SPEED_STATES\n                            or (fresh[0]["state"] != "done" and holding)',
             'fresh[0]["state"] not in SPEED_STATES', "test_fresh_active_holds_abort_and_release_unsent_claim", 1),
            ("fresh_normal_hold", 'fresh[0]["state"] not in {"done", "idle"}\n                            or (fresh[0]["state"] != "done" and holding)',
             'fresh[0]["state"] not in {"done", "idle"}', "test_fresh_active_holds_abort_and_release_unsent_claim", 1),
            ("malformed_state", 'except ValueError:\n        print("runner-dispatch: malformed last-dispatch.json',
             'except json.JSONDecodeError as error:\n        raise error\n        print("runner-dispatch: malformed last-dispatch.json',
             "test_malformed_dispatch_state_is_empty_with_one_log_line", 1),
            ("state_validation", 'raise ValueError("invalid dispatch timestamps")', 'return data',
             "test_malformed_dispatch_state_is_empty_with_one_log_line", 1),
            ("non_atomic_state", 'os.replace(temporary, path)\n    finally:\n        temporary.unlink(missing_ok=True)\n\n\ndef acquire_claim',
             'path.write_text(temporary.read_text())\n    finally:\n        temporary.unlink(missing_ok=True)\n\n\ndef acquire_claim',
             "test_dispatch_state_replaced_atomically_for_normal_speed_and_research", 1),
            ("temp_cleanup", "temporary.unlink(missing_ok=True)\n\n\ndef acquire_claim",
             "pass\n\n\ndef acquire_claim", "test_dispatch_state_write_failure_preserves_old_state_and_cleans_temp", 1),
        ]
        for name, old, new, test, count in mutants:
            with self.subTest(mutant=name):
                self.assertEqual(source.count(old), count)
                mutant = types.ModuleType("runner_dispatch_mutant")
                mutant.__file__ = str(SOURCE)
                exec(compile(source.replace(old, new, count), str(SOURCE), "exec"), mutant.__dict__)
                with patch.dict(globals(), m=mutant):
                    result = unittest.TextTestRunner(stream=io.StringIO()).run(
                        unittest.TestSuite([DispatchTests(test)]))
                self.assertFalse(result.wasSuccessful())
                self.assertTrue(result.failures or result.errors)
                self.assertTrue(all("AssertionError" in error for _, error in result.failures))
                expected_errors = (("AttributeError", "TypeError") if name == "state_validation"
                                   else ("JSONDecodeError", "ValueError: invalid dispatch timestamps"))
                self.assertTrue(all(any(expected in error for expected in expected_errors)
                                    for _, error in result.errors), result.errors)
                print(f"MUTATION KILLED {name}: DispatchTests.{test}")

    def test_atomic_link_claim_conflict_preserves_owner_and_removes_tmp(self):
        path = self.file_claim("HTPR-1", "Mini Boss CEO")
        before = path.read_bytes()
        self.assertFalse(m.acquire_claim("HTPR-1", self.rows[0], self.claim_dir, self.now))
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(list(self.claim_dir.glob("*.tmp.*")), [])
        self.assertTrue(m.acquire_claim("HTPR-2", self.rows[0], self.claim_dir, self.now))
        data = json.loads((self.claim_dir / "HTPR-2.json").read_text())
        self.assertEqual(set(data), {"ticket", "pane", "runner", "owner", "at", "pending_until"})
        self.assertEqual(data["owner"], m.OWNER)
        self.assertTrue(data["at"].endswith("+00:00"))

    def test_new_claim_is_published_with_pending_delivery_expiry(self):
        link = os.link
        def check_link(source, target):
            data = json.loads(source.read_text())
            self.assertIn("pending_until", data)
            self.assertEqual(data["pending_until"], self.now + m.PENDING_DELIVERY_TTL)
            self.assertGreater(data["pending_until"], self.now)
            link(source, target)
        with patch.object(m.os, "link", side_effect=check_link):
            self.assertTrue(m.acquire_claim("HTPR-1", self.rows[0], self.claim_dir, self.now))
        data = json.loads((self.claim_dir / "HTPR-1.json").read_text())
        self.assertEqual(data["pending_until"], self.now + m.PENDING_DELIVERY_TTL)
        self.commands.assert_not_called()

    def test_successful_delivery_atomically_clears_pending_expiry_after_last_send(self):
        self.add_speed_ticket()
        replace = os.replace
        for row, ticket in ((self.rows[0], "HTPR-1"), (self.rows[8], "HTPR-9")):
            with self.subTest(runner=row["runner"]):
                self.ready_go()
                self.commands.reset_mock()
                path = self.claim_dir / f"{ticket}.json"
                replacements = []
                def check_replace(source, target):
                    if target == path:
                        sent = [c.args for c in self.commands.call_args_list if "send-keys" in c.args]
                        self.assertEqual(len(sent), 2)
                        self.assertEqual(sent[-1], ("tmux", "send-keys", "-t", row["pane"], "Enter"))
                        before = json.loads(path.read_text())
                        self.assertEqual(before.pop("pending_until"), self.now + m.PENDING_DELIVERY_TTL)
                        self.assertEqual(json.loads(source.read_text()), before)
                        self.assertEqual(source.parent, path.parent)
                        replacements.append(target)
                    replace(source, target)
                with patch.object(m.os, "replace", side_effect=check_replace):
                    self.assertEqual(self.dispatch([row], go=True)[0]["action"], "sent")
                self.assertEqual(replacements, [path])
                self.assertNotIn("pending_until", json.loads(path.read_text()))
                self.assertEqual(list(self.claim_dir.glob("*.tmp.*")), [])

    def test_killed_process_pending_claim_expires_and_next_run_dispatches_again(self):
        self.add_speed_ticket()
        for row, ticket in ((self.rows[0], "HTPR-1"), (self.rows[8], "HTPR-9")):
            with self.subTest(runner=row["runner"]):
                self.ready_go()
                self.commands.reset_mock()
                with patch.object(m, "snapshots", side_effect=SystemExit("process terminated")):
                    with self.assertRaises(SystemExit):
                        self.dispatch([row], go=True)
                self.assertFalse(any("send-keys" in c.args for c in self.commands.call_args_list))
                path = self.claim_dir / f"{ticket}.json"
                self.assertNotIn("failed_delivery_until", json.loads(path.read_text()))
                self.now += m.PENDING_DELIVERY_TTL - 1
                self.dispatch([], go=True)
                self.assertTrue(path.exists())
                self.now += 2
                before = path.read_bytes()
                self.dispatch([], go=False)
                self.dispatch([], load=13, go=True)
                self.assertEqual(path.read_bytes(), before)
                result = self.dispatch([row], go=True)[0]
                self.assertEqual((result["action"], result["ticket"]), ("sent", ticket))
                self.assertNotIn("pending_until", json.loads(path.read_text()))

    def test_delivered_claim_never_expires_before_done(self):
        self.add_speed_ticket()
        for row, ticket in ((self.rows[0], "HTPR-1"), (self.rows[8], "HTPR-9")):
            with self.subTest(runner=row["runner"]):
                self.ready_go()
                self.assertEqual(self.dispatch([row], go=True)[0]["ticket"], ticket)
                path = self.claim_dir / f"{ticket}.json"
                before = path.read_bytes()
                self.assertNotIn("pending_until", json.loads(before))
                self.now += 10 * max(m.PENDING_DELIVERY_TTL, m.FAILED_DELIVERY_TTL)
                self.dispatch([], go=True)
                self.assertTrue(path.exists())
                self.assertEqual(path.read_bytes(), before)
                self.assertNotIn(ticket, m.free_tickets(self.boards, self.comments, self.claim_dir))
                next(task for task in self.boards[15] if task["ticketNumber"] == ticket)["section"] = "Done"
                self.dispatch([], go=True)
                self.assertFalse(path.exists())

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

    def test_snapshot_script_falls_back_to_runners_skill_and_names_paths_when_missing(self):
        with tempfile.TemporaryDirectory() as root:
            local, skill = Path(root) / "local", Path(root) / "skill"
            with patch.object(m, "SNAPSHOT_CANDIDATES", (local, skill)):
                with self.assertRaisesRegex(RuntimeError, "runner-snapshot not found in: .*local.*skill"):
                    m.snapshot_script()
                skill.write_text("")
                self.assertEqual(m.snapshot_script(), skill)
                local.write_text("")
                self.assertEqual(m.snapshot_script(), local)

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
            for failed_send in (1, 2):
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
        self.assertEqual(sent, [("tmux", "send-keys", "-t", "%1", "-l", "/ship HTPR-1"),
                               ("tmux", "send-keys", "-t", "%1", "Enter")])
        self.assertEqual([c.args for c in self.sleep.call_args_list], [(1,)])
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
        self.assertEqual(set(cache), set(self.comments) | {"HTPR-98"})
        self.assertEqual(len(calls), len(cache))
        self.assertTrue(all(c[-3:] == ("--limit", "50", "--json") for c in calls))


if __name__ == "__main__":
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(DispatchTests))
    if not result.wasSuccessful():
        raise SystemExit(1)
    print("ALL PASS")
