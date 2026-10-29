import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parent
loader = importlib.machinery.SourceFileLoader("guarded_dispatch", str(SCRIPTS / "runner-dispatch"))
spec = importlib.util.spec_from_loader(loader.name, loader)
dispatch = importlib.util.module_from_spec(spec)
loader.exec_module(dispatch)


class AdmissionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.bin = self.home / ".local/bin"
        self.bin.mkdir(parents=True)
        self.calls = self.home / "calls"
        self.repo = self.home / "projects/hypertask"
        setup = self.repo / ".claude/skills/setup-runner/scripts/setup-runner"
        setup.parent.mkdir(parents=True)
        setup.write_text('#!/bin/sh\necho setup >> "$HOME/calls"\n')
        setup.chmod(0o755)
        self.executable("session-policy-guard", '''import json, os, pathlib, sys
with (pathlib.Path.home() / "calls").open("a") as out: out.write("guard " + json.dumps(sys.argv[1:]) + "\\n")
sys.exit(int(os.environ.get("DENY_POLICY", "0")))
''')
        self.executable("tmux", '''import pathlib, sys
with (pathlib.Path.home() / "calls").open("a") as out: out.write("tmux " + " ".join(sys.argv[1:]) + "\\n")
sys.exit(1 if sys.argv[1] == "has-session" else 0)
''')
        self.executable("hax", 'import pathlib; (pathlib.Path.home() / "unexpected-model-call").touch()')
        self.executable("clear", 'pass')
        shell_env = self.home / "bash-env"
        shell_env.write_text("sleep() { exit 97; }\n")
        self.env = {"HOME": str(self.home), "PATH": str(self.bin) + ":" + os.environ["PATH"], "BASH_ENV": str(shell_env)}

    def executable(self, name, body):
        path = self.bin / name
        path.write_text("#!/usr/bin/env python3\n" + body)
        path.chmod(0o755)

    def pool(self, *args, deny=False):
        return subprocess.run([str(SCRIPTS / "ht-hax-runner"), *args],
                              env=dict(self.env, DENY_POLICY="1" if deny else "0"),
                              capture_output=True, text=True, timeout=10)

    def test_pool_check_uses_exact_subscription_launch_options(self):
        result = self.pool("check")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls.read_text().splitlines(), ["guard " + json.dumps([
            "--project", str(self.repo), "--", "hax", "--provider=codex", "--model=gpt-6.1-sol", "--effort=medium"])])

    def test_refused_pool_cannot_create_session_or_setup_identity(self):
        result = self.pool("11", deny=True)
        self.assertNotEqual(result.returncode, 0)
        lines = self.calls.read_text().splitlines()
        self.assertEqual(len(lines), 2)
        self.assertEqual(lines[0], "tmux has-session -t ht-hax-runner-11")
        self.assertTrue(lines[1].startswith("guard "))
        self.assertIn("launch refused", (self.home / ".local/state/ht-hax-runners/keeper.log").read_text())

    def test_refused_loop_never_starts_prompt_delivery_or_hax(self):
        result = self.pool("11", "--loop", deny=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(self.calls.read_text().splitlines()), 1)
        self.assertTrue(self.calls.read_text().startswith("guard "))

    def test_clean_pool_preserves_setup_before_session_creation(self):
        result = self.pool("11")
        self.assertEqual(result.returncode, 0, result.stderr)
        lines = self.calls.read_text().splitlines()
        self.assertTrue(lines[1].startswith("guard "))
        self.assertEqual(lines[2], "setup")
        self.assertTrue(lines[3].startswith("tmux new-session "))
        self.assertIn("started: ht-hax-runner-11", result.stdout)

    def test_missing_guard_fails_closed(self):
        (self.bin / "session-policy-guard").unlink()
        self.assertNotEqual(self.pool("11").returncode, 0)
        self.assertEqual(self.calls.read_text().splitlines(), ["tmux has-session -t ht-hax-runner-11"])

    def test_dispatch_cli_refuses_before_fetch_or_work_delivery(self):
        for enabled in ([], ["--go"]):
            with self.subTest(argv=enabled), patch.object(Path, "home", return_value=self.home), \
                    patch.dict(os.environ, self.env, clear=True), patch.object(sys, "argv", ["runner-dispatch", *enabled]), \
                    patch.object(dispatch, "LOOP", self.home / ".local/state/runner-loop"), \
                    patch.object(dispatch, "run") as run:
                os.environ["DENY_POLICY"] = "1"
                with self.assertRaises(RuntimeError):
                    dispatch.main()
                run.assert_not_called()
        self.assertFalse((self.home / ".local/state/runner-loop").exists())

    def test_clean_dispatch_cli_reaches_existing_read_only_plan(self):
        with patch.object(Path, "home", return_value=self.home), patch.dict(os.environ, self.env, clear=True), \
                patch.object(sys, "argv", ["runner-dispatch"]), patch.object(dispatch, "LOOP", self.home / ".local/state/runner-loop"), \
                    patch.object(dispatch, "run") as run:
            dispatch.main()
            run.assert_called_once_with(False, cache_path=dispatch.LOOP / "comments-cache.json")
        self.assertEqual(len(self.calls.read_text().splitlines()), 1)


if __name__ == "__main__":
    result = unittest.main(exit=False)
    if not result.result.wasSuccessful():
        raise SystemExit(1)
    print("launch admission integration tests passed")
