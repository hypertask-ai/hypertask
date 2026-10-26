#!/usr/bin/env python3
import importlib.machinery
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

loader = importlib.machinery.SourceFileLoader("runner_dispatch_snapshot", str(Path(__file__).with_name("runner-dispatch")))
spec = importlib.util.spec_from_loader(loader.name, loader)
m = importlib.util.module_from_spec(spec)
loader.exec_module(m)


class SnapshotTests(unittest.TestCase):
    def test_hax_sessions_count_without_becoming_claude_dispatch_targets(self):
        sessions = ["hax-pool-htpr-1", "tl-ht-hax", "ht-hax-runner-13", "hax-runner-1"]
        listing = "\n".join(f"%{n}\t{name}\thypertask-vps" for n, name in enumerate(sessions))
        with patch.object(m, "snapshot_script", return_value=Path("/fixture/snapshot")), \
                patch.object(m, "command", side_effect=["", listing]):
            rows = m.snapshots()
        self.assertEqual(rows, [{"runner": f"HAX {name}", "pane": f"%{n}", "state": "busy"}
                                for n, name in enumerate(sessions)])
        self.assertTrue(all(row["runner"] not in m.ELIGIBLE for row in rows))

    def test_existing_panes_preserved_and_unrelated_sessions_ignored(self):
        row = {"runner": "RUNNER 1", "pane": "%1", "state": "idle"}
        listing = "%1\tht-runners\tRUNNER 1\n%2\tother-project\thypertask-vps"
        with patch.object(m, "snapshot_script", return_value=Path("/fixture/snapshot")), \
                patch.object(m, "command", side_effect=[json.dumps(row), listing]):
            self.assertEqual(m.snapshots(), [row])

    def test_hax_with_claude_style_title_cannot_receive_claude_commands(self):
        row = {"runner": "RUNNER 1", "pane": "%1", "state": "idle"}
        with patch.object(m, "snapshot_script", return_value=Path("/fixture/snapshot")), \
                patch.object(m, "command", side_effect=[json.dumps(row), "%1\tht-hax-runner-1\tRUNNER 1"]):
            self.assertEqual(m.snapshots(), [{"runner": "HAX ht-hax-runner-1", "pane": "%1", "state": "busy"}])

    def test_no_tmux_server_is_empty_but_permission_errors_fail(self):
        for error, empty in [("no server running on /tmp/fixture", True),
                             ("error connecting to /tmp/fixture (No such file or directory)", True),
                             ("permission denied", False)]:
            with self.subTest(error=error), \
                    patch.object(m, "snapshot_script", return_value=Path("/fixture/snapshot")), \
                    patch.object(m, "command", side_effect=["", RuntimeError(error)]):
                if empty:
                    self.assertEqual(m.snapshots(), [])
                else:
                    with self.assertRaises(RuntimeError):
                        m.snapshots()


if __name__ == "__main__":
    unittest.main(verbosity=2)
