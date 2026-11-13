#!/usr/bin/env python3
import http.server
import os
from pathlib import Path
import subprocess
import threading
import unittest

HERE = Path(__file__).resolve().parent


class Handler(http.server.BaseHTTPRequestHandler):
    hits = {'rollout': 0}

    def do_GET(self):
        if self.path == '/ok':
            self.reply(200, 'app is ready')
        elif self.path == '/rollout':
            Handler.hits['rollout'] += 1
            if Handler.hits['rollout'] < 2:
                self.reply(503, 'deploying')
            else:
                self.reply(200, 'app is ready')
        elif self.path == '/wrong':
            self.reply(200, 'maintenance')
        else:
            self.reply(404, 'not found')

    def reply(self, status, body):
        payload = body.encode()
        self.send_response(status)
        self.send_header('Content-Type', 'text/plain')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


class ShipLiveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def live(self, *args):
        return subprocess.run([str(HERE / 'ship-live'), *args], capture_output=True, text=True,
                              env=dict(os.environ), timeout=120)

    def test_passes_when_the_page_answers_as_expected(self):
        result = self.live(f'{self.base}/ok', '--expect', 'app is ready', '--timeout', '5', '--interval', '1')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('200 after', result.stdout)

    def test_retries_while_a_deployment_rolls_out(self):
        result = self.live(f'{self.base}/rollout', '--expect', 'app is ready', '--timeout', '10', '--interval', '1')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_fails_when_the_expected_text_never_appears(self):
        result = self.live(f'{self.base}/wrong', '--expect', 'app is ready', '--timeout', '2', '--interval', '1')
        self.assertEqual(result.returncode, 1)
        self.assertIn('does not contain', result.stderr)

    def test_fails_on_an_unexpected_status(self):
        result = self.live(f'{self.base}/missing', '--timeout', '2', '--interval', '1')
        self.assertEqual(result.returncode, 1)
        self.assertIn('status 404', result.stderr)

    def test_rejects_a_bad_status_code(self):
        self.assertEqual(self.live(f'{self.base}/ok', '--status', 'nope').returncode, 3)

    def test_rejects_a_non_http_url(self):
        self.assertEqual(self.live('ftp://example.com/page').returncode, 3)

    def test_usage_exit(self):
        self.assertEqual(self.live().returncode, 3)


if __name__ == '__main__':
    unittest.main()
