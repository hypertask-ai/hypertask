#!/usr/bin/env python3
"""Check credential forwarding using two loopback servers and a dummy token."""
import http.server
import json
import os
import subprocess
import tempfile
import threading


def main():
    seen = []

    class Target(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            seen.append(bool(self.headers.get("Authorization")))
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"success":true,"projects":[]}')

        def log_message(self, *args):
            pass

    target = http.server.HTTPServer(("127.0.0.1", 0), Target)

    class Redirect(Target):
        def do_GET(self):
            self.send_response(302)
            self.send_header("Location", f"http://localhost:{target.server_port}/destination")
            self.end_headers()

    redirect = http.server.HTTPServer(("127.0.0.1", 0), Redirect)
    servers = [redirect, target]
    for server in servers:
        threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with tempfile.TemporaryDirectory(prefix="strix-cli-") as home:
            result = subprocess.run(
                [os.environ.get("STRIX_CLI", "hypertask"), "--api-url",
                 f"http://127.0.0.1:{redirect.server_port}/api", "project", "list", "--json"],
                env={"PATH": os.environ["PATH"], "HOME": home,
                     "HYPERTASKS_JWT_TOKEN": "strix-dummy-token-not-a-credential"},
                capture_output=True, text=True, timeout=20,
            )
        print(json.dumps({"exitCode": result.returncode, "redirectFollowed": bool(seen),
                          "authorizationForwarded": any(seen)}))
        return 2 if any(seen) else 0 if seen and result.returncode == 0 else 1
    finally:
        for server in servers:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    raise SystemExit(main())
