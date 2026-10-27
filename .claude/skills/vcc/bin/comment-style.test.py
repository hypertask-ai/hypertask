import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class CommentStyleTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.bin = self.home / "bin"
        self.bin.mkdir()
        self.trace = self.home / "trace"
        cli = self.bin / "hypertask"
        cli.write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$STYLE_TRACE"\n')
        cli.chmod(0o755)
        identity = self.home / ".agents/skills/ship/scripts/ship-identity"
        identity.parent.mkdir(parents=True)
        identity.write_text('#!/bin/sh\necho "credentials reached" >&2\nexit 99\n')
        identity.chmod(0o755)
        self.env = dict(os.environ, HOME=str(self.home),
                        PATH=f"{self.bin}:{os.environ['PATH']}",
                        STYLE_TRACE=str(self.trace),
                        VCC_HELPER_PROC_ROOT=str(self.home / "proc"))
        self.env.pop("VCC_HELPER", None)
        self.wrapper = Path(__file__).with_name("vcc")

    def invoke(self, text, kind="qa", *options):
        return subprocess.run(["bash", str(self.wrapper), "comment", "add", "X-1",
                               *(["--kind", kind] if kind else []),
                               "--text", text, *options], env=self.env,
                              capture_output=True, text=True)

    def assert_refused(self, text, reason, kind="qa", *options):
        result = self.invoke(text, kind, *options)
        self.assertEqual(result.returncode, 5, result.stderr)
        self.assertIn(reason, result.stderr)
        self.assertNotIn("credentials reached", result.stderr)
        self.assertFalse(self.trace.exists())

    def assert_allowed(self, text, kind="qa", *options):
        identity = self.home / ".agents/skills/ship/scripts/ship-identity"
        token = self.home / "token"
        token.write_text("fixture-token")
        identity.write_text(f'#!/bin/sh\nprintf "Fixture\\t%s\\n" "{token}"\n')
        result = self.invoke(text, kind, *options)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.trace.read_text().splitlines(),
                         ["comment", "add", "X-1",
                          *(["--kind", kind] if kind else []),
                          "--text", *text.splitlines(), *options])

    def test_rules_refuse_before_credentials(self):
        cases = [
            ("<p><strong>Ready — now.</strong></p>", "em dash"),
            ("<p><strong>Ready &#8212; now.</strong></p>", "em dash"),
            ("<p><strong>" + "word " * 26 + ".</strong></p>", "25 words"),
            ("<p><strong>Changed src/app/page.tsx.</strong></p>", "file paths"),
            ("<p><strong>Changed <code>useFlag</code>.</strong></p>", "code names"),
            ("<p><strong>Changed `user_id`.</strong></p>", "code names"),
            ("<p><strong>Changed runner13/comment-style.</strong></p>", "file paths"),
            ("<p><strong>Ready PR #123.</strong></p>", "linked"),
            ("<p><strong>Ready #123.</strong></p>", "linked"),
            ("<p><strong>I'll check.</strong></p>", "filler"),
            ("<p><strong>Let me check.</strong></p>", "filler"),
            ("<p><strong>Great, fixed.</strong></p>", "filler"),
            ("<p><strong>Sure, fixed.</strong></p>", "filler"),
            ("<p><strong>I hope this helps.</strong></p>", "filler"),
            ("<p>Ready.</p>", "bold"),
            ("<p>Ready. <strong>Details.</strong></p>", "bold"),
            ("<p><strong>Ready</strong> after review.</p>", "bold"),
            ("<p><strong></strong>Ready.</p>", "bold"),
        ]
        for text, reason in cases:
            with self.subTest(text=text):
                self.assert_refused(text, reason)

    def test_human_kinds_are_checked(self):
        for kind in ["question", "qa", "done"]:
            with self.subTest(kind=kind):
                prefix = ("<p>Question: <strong>Keep it?</strong></p>"
                          "<p>Yes: keep it.</p><p>No: remove it.</p>"
                          "<p>My recommendation: yes.</p><p>Why: less work.</p>"
                          if kind == "question" else "<p><strong>Ready.</strong></p>")
                self.assert_refused(prefix + "<p>Sure, fixed.</p>", "filler", kind)

    def test_short_bold_comment_and_linked_reference_pass(self):
        self.assert_allowed('<p><strong>Ready.</strong></p><p><a href="https://github.com/a/b/pull/123">PR #123</a></p>')

    def test_plain_slash_words_and_url_details_pass(self):
        self.assert_allowed("<p><strong>Ready.</strong></p><p>Pick yes/no and/or keep both.</p>"
                            "<p>https://example.test/src/app.tsx?branch=runner13/test#123</p>")

    def test_installed_symlink_finds_the_parser(self):
        installed = self.bin / "vcc"
        installed.symlink_to(self.wrapper)
        self.wrapper = installed
        self.assert_allowed("<p><strong>Ready.</strong></p>")

    def test_flag_question_with_mention_passes(self):
        self.assert_allowed('<p><span data-type="mention">Valentin Yeo</span> '
                            'Question: <strong>Switch <code>htpr-654-clear-comments</code> to Everyone?</strong></p>'
                            '<p>Yes: switch it.</p><p>No: keep it.</p>'
                            '<p>My recommendation: yes.</p><p>Why: checks passed.</p>', "question")

    def test_exact_word_limit_passes(self):
        self.assert_allowed("<p><strong>" + "word " * 25 + ".</strong></p>")

    def test_long_agent_notes_stay_available(self):
        self.assert_allowed("src/app/page.tsx — " + "word " * 30, None)

    def test_state_and_resume_fields_pass(self):
        self.assert_allowed("<p><strong>Waiting for checks.</strong></p>"
                            "<p>Next: tmux attach -t ht-hax-runner-13 (hax RUNNER 13)</p>"
                            "<p>Helpers: none</p><p>Branch/PR: runner13/comment-style</p>"
                            "<p>Outputs: /home/valentin/report.html</p>")

    def test_markdown_passes(self):
        self.assert_allowed("**Ready.**\n\n[PR #123](https://github.com/a/b/pull/123)", "done", "--markdown")

    def test_source_line_wrapping_does_not_split_sentences(self):
        self.assert_refused("<p><strong>Ready.</strong></p><p>" + "word " * 15
                            + "\n" + "word " * 15 + ".</p>", "25 words")

    def test_markdown_lists_keep_separate_items(self):
        self.assert_allowed("**Ready.**\n\n- " + "word " * 15
                            + "\n- " + "word " * 15, "qa", "--markdown")
        self.assert_refused("**Ready.**\n\n- " + "word " * 15
                            + "\n  " + "word " * 15, "25 words", "qa", "--markdown")

    def test_file_and_equals_forms_are_checked(self):
        source = self.home / "comment.md"
        source.write_text("<p><strong>Sure, fixed.</strong></p>")
        for args in [["--file", str(source)], [f"--file={source}"],
                     ["--body=<p><strong>Sure, fixed.</strong></p>"]]:
            result = subprocess.run(["bash", str(self.wrapper), "comments", "add", "X-1",
                                     "--kind=done", *args], env=self.env,
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 5, result.stderr)
            self.assertIn("filler", result.stderr)
            self.assertNotIn("credentials reached", result.stderr)


if __name__ == "__main__":
    unittest.main()
