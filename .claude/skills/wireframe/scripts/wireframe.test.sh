#!/usr/bin/env bash
# Offline CLI tests. All HTTP and board calls are stubs; one capture uses installed Playwright.
set -euo pipefail
cd "$(dirname "$0")"
D=$(mktemp -d "$PWD/.wireframe-test.XXXXXX"); trap 'rm -rf "$D"' EXIT
export TEST_DIR="$D" WIREFRAME_SCRIPT="$PWD/wireframe"
mkdir -p "$D/bin" "$D/home/.local/bin" "$D/modules" "$D/npm-cache" "$D/tmp"
export REAL_NPX="$(command -v npx || true)"
export npm_config_prefix="$(dirname "$(dirname "$(command -v playwright)")")"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
export HOME="$D/home" WIREFRAME_HOME="$D/data" TMPDIR="$D/tmp"
export PYTHONDONTWRITEBYTECODE=1 PYTHONPATH="$D/modules"
export npm_config_offline=true npm_config_cache="$D/npm-cache" npm_config_update_notifier=false
cat > "$HOME/.local/bin/htmlshare" <<'PY'
BASE = "https://hypertask.app"
UA = "wireframe-test"
_CREDS = {"HYPERTASK_APP_SHARE_TOKEN": "stub-token", "HYPERTASK_APP_CF_CLIENT_ID": "stub-id", "HYPERTASK_APP_CF_CLIENT_SECRET": "stub-secret"}
PY
# Exercise the CLI fallback consistently even on hosts with Python Playwright installed.
cat > "$D/modules/playwright.py" <<'PY'
raise ImportError("use offline CLI test backend")
PY
cat > "$D/modules/sitecustomize.py" <<'PY'
import io, json, os, socket, urllib.request
from pathlib import Path

def log(event):
    with open(Path(os.environ["TEST_DIR"]) / "log", "a") as f:
        f.write(json.dumps(event) + "\n")

def urlopen(request, timeout):
    assert timeout == 30
    assert request.full_url.startswith("https://hypertask.app/wireframes/")
    method = request.get_method()
    log({"kind": "http", "method": method, "url": request.full_url, "headers": dict(request.header_items())})
    if os.environ.get("FAIL_HTTP") == method:
        raise OSError("stub HTTP failure")
    body = Path(os.environ["TEST_DIR"]) / "uploaded"
    if method == "PUT":
        body.write_bytes(request.data)
        return io.BytesIO(b"")
    assert method == "GET"
    return io.BytesIO(b"wrong bytes" if os.environ.get("MISMATCH") else body.read_bytes())

def no_network(*args, **kwargs):
    raise AssertionError("real network forbidden")

urllib.request.urlopen = urlopen
socket.socket = no_network
socket.create_connection = no_network
PY
cat > "$D/bin/stub" <<'PY'
#!/usr/bin/env python3
import json, os, struct, sys, zlib
from pathlib import Path
name, args = Path(sys.argv[0]).name, sys.argv[1:]
with open(Path(os.environ["TEST_DIR"]) / "log", "a") as f:
    f.write(json.dumps({"kind": name, "args": args}) + "\n")
if name == "hypertask":
    if args[:2] == ["tasks", "get"]:
        if os.environ.get("FAIL_TICKET"):
            sys.exit(1)
        print(json.dumps({"tasks": [{"title": 'Full <ticket> & "title"', "projectId": int(os.environ.get("PROJECT_ID", "15")), "uniqueIndex": 255}]}))
    elif args[:2] == ["sections", "list"]:
        assert args[2:] == ["--project", os.environ.get("PROJECT_ID", "15"), "--json"]
        if os.environ.get("FAIL_SECTIONS"):
            sys.exit(1)
        print(json.dumps({"success": True, "sections": [{"section_title": s} for s in json.loads(os.environ.get("SECTIONS", '["UX Sign-off"]'))]}))
    else:
        sys.exit(1)
elif name == "vcc":
    if os.environ.get("FAIL_VCC") == args[0]:
        print("stub vcc failure", file=sys.stderr)
        sys.exit(1)
    assert args[:2] in (["comment", "add"], ["task", "move"])
elif name == "npx":
    assert args[:4] == ["-y", "playwright", "screenshot", "--viewport-size=1440,900"]
    assert args[4].startswith("file://")
    if os.environ.get("FAIL_SCREENSHOT"):
        sys.exit(1)
    if os.environ.get("NO_SCREENSHOT"):
        sys.exit(0)
    if os.environ.get("REAL_SCREENSHOT"):
        os.execv(os.environ["REAL_NPX"], [os.environ["REAL_NPX"]] + args)
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1440, 900, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress((b"\0" + b"\xff" * (1440 * 3)) * 900)) + chunk(b"IEND", b"")
    Path(args[5]).write_bytes(png)
else:
    sys.exit(1)
PY
chmod +x "$D/bin/stub"
for cmd in hypertask vcc npx; do ln -s stub "$D/bin/$cmd"; done
export PATH="$D/bin:$PATH"
python3 - <<'PY'
import html, json, os, struct, subprocess
from datetime import date
from pathlib import Path

D, home, script = Path(os.environ["TEST_DIR"]), Path(os.environ["WIREFRAME_HOME"]), os.environ["WIREFRAME_SCRIPT"]
logfile = D / "log"
passes = 0

def invoke(*args, fail=False, **env):
    logfile.write_text("")
    p = subprocess.run(["python3", script, *args], capture_output=True, text=True, env={**os.environ, **env})
    assert (p.returncode != 0) if fail else (p.returncode == 0), p.stderr
    return p, [json.loads(line) for line in logfile.read_text().splitlines()]

def ok(label):
    global passes
    passes += 1
    print("ok   " + label, flush=True)

def events(log, kind):
    return [e for e in log if e["kind"] == kind]

def uploaded(log, status, ticket="HTPR-255", project=15):
    calls = events(log, "http")
    assert calls[0]["method"] == "PUT"
    assert calls[0]["url"] == "https://hypertask.app/wireframes/" + ticket.lower()
    h = {k.lower(): v for k, v in calls[0]["headers"].items()}
    assert h["x-status"] == status
    assert h["x-ticket-url"] == f"https://app.hypertask.ai/detail/project-{project}/255"
    assert h["x-title"] == ("Base kit: full app" if ticket == "BASE" else 'Full <ticket> & "title"')
    f = home / ("base/base-kit.html" if ticket == "BASE" else ticket + "/index.html")
    assert (D / "uploaded").read_bytes() == f.read_bytes()
    return calls

def full_publish(ticket="HTPR-255", move=True, **env):
    question = 'Build <this> & "that"?'
    p, log = invoke("publish", ticket, "--question", question, **env)
    calls = uploaded(log, "waiting", ticket, int(env.get("PROJECT_ID", "15")))
    assert [c["method"] for c in calls] == ["PUT", "GET"]
    assert calls[0]["headers"] == calls[1]["headers"]
    writes = events(log, "vcc")
    assert len(writes) == (2 if move else 1)
    comment = writes[0]["args"]
    assert comment[:4] == ["comment", "add", ticket, "--text"]
    url = calls[0]["url"]
    expected = ('<p><strong>Wireframe ready for ' + html.escape('Full <ticket> & "title"') + '.</strong></p>'
                + f'<p><a href="{url}">{url}</a></p>'
                + f'<p>Requested by Valentin in a Claude session, {date.today().isoformat()}.'
                + (f' claude --resume {os.environ["CLAUDE_CODE_SESSION_ID"]}' if os.environ.get("CLAUDE_CODE_SESSION_ID") else '') + '</p>'
                + '<p>Question: <span data-type="mention" class="mention" data-id="Valentin Yeo" data-label="name-6">Valentin Yeo</span> '
                + html.escape(question) + '</p>')
    assert comment[4] == expected
    assert comment[5] == "--attach"
    png = Path(comment[6])
    assert png == Path(os.environ["HOME"]) / ".local/state/vcc-evidence" / ticket / "wireframe/desktop.png"
    body = png.read_bytes()
    assert body[:8] == b"\x89PNG\r\n\x1a\n"
    assert struct.unpack(">II", body[16:24]) == (1440, 900)
    if move:
        assert writes[1]["args"] == ["task", "move", ticket, "--section", "UX Sign-off"]
    kinds = [e["kind"] for e in log]
    assert kinds.index("vcc") > max(i for i, e in enumerate(log) if e["kind"] == "http")
    return log

kit = D / "kit.html"
kit.write_text('<!doctype html><html><head><title>Local kit</title></head><body><a href="#option">Today</a><button onclick="document.getElementById(\'option\').textContent=\'Approved\'">Option</button><p id="option">Wireframe</p></body></html>')
invoke("base", str(kit))
p, _ = invoke("new", "htpr-255")
assert Path(p.stdout.strip()) == home / "HTPR-255/index.html"
assert Path(p.stdout.strip()).read_bytes() == kit.read_bytes()
invoke("new", "YPER4-255")
p, _ = invoke("new", "HTPR-255", fail=True)
assert "already exists" in p.stderr
ok("new copies the full kit without overwriting")

for args, message in [((), "--question is required"), (("--question", "Build this"), "must end with"), (("--question", "   "), "must end with")]:
    p, log = invoke("publish", "HTPR-255", *args, fail=True)
    assert message in p.stderr and not log
ok("missing or invalid question fails before any upload or CLI call")

p, log = invoke("publish", "HTPR-255", "--no-comment")
assert len(uploaded(log, "waiting")) == 1
assert not events(log, "vcc") and not events(log, "npx")
ok("publish --no-comment sends waiting and uploads only")

full_publish()
ok("publish verifies identical authenticated GET, attaches PNG and posts one escaped comment before board 15 move")
full_publish("YPER4-255", move=False, PROJECT_ID="4060", SECTIONS='["Todo"]')
ok("other board without UX Sign-off does not move")
full_publish("YPER4-255", PROJECT_ID="4060")
ok("other board with a confirmed UX Sign-off section moves")
full_publish(move=False, SECTIONS="[]")
ok("board 15 with known absent section does not move")
full_publish(FAIL_SECTIONS="1")
full_publish("YPER4-255", move=False, PROJECT_ID="4060", FAIL_SECTIONS="1")
ok("unknown sections fall back to a move only on board 15")

for status in ("waiting", "approved", "rejected"):
    p, log = invoke("status", "HTPR-255", status)
    assert len(uploaded(log, status)) == 1 and not events(log, "vcc") and not events(log, "npx")
ok("status re-uploads all three statuses with original ticket headers")
p, log = invoke("status", "HTPR-999", "approved", fail=True)
assert "local file missing" in p.stderr and not log
p, log = invoke("status", "HTPR-255", "invalid", fail=True)
assert "invalid choice" in p.stderr and not log
ok("status rejects missing files and invalid states before upload")

p, log = invoke("publish", "BASE")
assert len(uploaded(log, "waiting", "BASE", 4060)) == 1
assert not events(log, "vcc") and not events(log, "hypertask") and not events(log, "npx")
ok("BASE uploads only and links to project-4060/255")

for env, message in [({"FAIL_HTTP": "PUT"}, "stub HTTP failure"), ({"FAIL_HTTP": "GET"}, "stub HTTP failure"), ({"MISMATCH": "1"}, "upload verification failed"), ({"FAIL_SCREENSHOT": "1"}, "returned non-zero"), ({"NO_SCREENSHOT": "1"}, "no PNG captured")]:
    p, log = invoke("publish", "HTPR-255", "--question", "Build this?", fail=True, **env)
    assert message in p.stderr and not events(log, "vcc")
    if "FAIL_SCREENSHOT" not in env and "NO_SCREENSHOT" not in env:
        assert not events(log, "npx")
ok("upload, verification and screenshot failures prevent comments and moves")
p, log = invoke("publish", "HTPR-255", "--question", "Build this?", fail=True, FAIL_VCC="comment")
assert len(events(log, "vcc")) == 1
p, log = invoke("publish", "HTPR-255", "--question", "Build this?", fail=True, FAIL_VCC="task")
assert len(events(log, "vcc")) == 2
p, log = invoke("publish", "HTPR-255", "--no-comment", fail=True, FAIL_TICKET="1")
assert "cannot read ticket" in p.stderr and not events(log, "http")
ok("CLI failures are loud and a failed comment never moves the ticket")

full_publish(REAL_SCREENSHOT="1")
ok("installed Playwright captures real local PNG at 1440x900 with npm offline")
print(f"{passes} passed, 0 failed")
PY
