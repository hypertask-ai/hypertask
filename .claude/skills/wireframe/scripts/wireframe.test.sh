#!/usr/bin/env bash
# Offline CLI tests. HTTP and board calls are stubs; link, token, capture and clone checks use local Playwright.
set -euo pipefail
cd "$(dirname "$0")"
D=$(mktemp -d "$PWD/.wireframe-test.XXXXXX"); trap 'rm -rf "$D"' EXIT
export TEST_DIR="$D" WIREFRAME_SCRIPT="$PWD/wireframe"
mkdir -p "$D/bin" "$D/home/.local/bin" "$D/modules" "$D/npm-cache" "$D/tmp"
export REAL_NPX="$(command -v npx || true)"
export npm_config_prefix="$(dirname "$(dirname "$(command -v playwright)")")"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
if [ -f "$HOME/.local/state/vcc-evidence/HTPR-7724/wireframe/live-styles.json" ]; then
    cp "$HOME/.local/state/vcc-evidence/HTPR-7724/wireframe/live-styles.json" "$D/live-styles-redo.json"
fi
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
import base64, html, json, os, struct, subprocess, zlib
from datetime import date
from pathlib import Path

D, home, script = Path(os.environ["TEST_DIR"]), Path(os.environ["WIREFRAME_HOME"]), os.environ["WIREFRAME_SCRIPT"]
fixtures = Path(os.environ["TEST_DIR"]).parent / "fixtures"
logfile = D / "log"
passes = 0
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
TURL = "https://app.hypertask.ai/detail/project-15/255"
TOKENS = f"publish refused: this page uses fonts, colours, sizes or radii outside the app's design system; start from `wireframe new <TICKET>` (the live-app base kit) and reuse its classes"
TODAY = "publish refused: live captures of the changed screen are missing; run: wireframe capture <TICKET> <app URL path> to take 390x844 and 1440x900 screenshots in Porcelain, Graphite, AMOLED and Dia and show them in a Today section"

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

def png_for(width, height):
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + ihdr + struct.pack(">I", zlib.crc32(b"IHDR" + ihdr))

def add_today(folder):
    shots = folder / "today"
    shots.mkdir(exist_ok=True)
    manifest = []
    for theme in ("porcelain", "graphite", "amoled", "dia"):
        for name, viewport in (("mobile", "390x844"), ("desktop", "1440x900")):
            shot = f"today/{name}-{theme}.png"
            (folder / shot).write_bytes(png_for(*map(int, viewport.split("x"))))
            manifest.append({"file": shot, "viewport": viewport, "theme": theme, "sourceUrl": TURL, "capturedAt": "2026-11-23T10:00:00Z"})
    (folder / "today.json").write_text(json.dumps(manifest))
    figures = "".join(f'<figure><img alt="{e["theme"]} {e["viewport"]}" src="data:image/png;base64,{base64.b64encode((folder / e["file"]).read_bytes()).decode()}" data-capture="{e["file"]}"><figcaption>{e["theme"]} {e["viewport"]}</figcaption></figure>' for e in manifest)
    section = f'<section data-wireframe-today id="today"><h2>Today</h2>{figures}</section>'
    page = folder / "index.html"
    body = page.read_text()
    start = body.find('<section data-wireframe-today')
    if start >= 0:
        end = body.index('</section>', start) + len('</section>')
        body = body[:start] + body[end:]
    page.write_text(body.replace("</body>", section + "</body>"))
    return manifest

def full_publish(ticket="HTPR-255", move=True, **env):
    question = 'Build <this> & "that"?'
    p, log = invoke("publish", ticket, "--question", question, "--why", 'It reuses <rows> & "chips".', **env)
    calls = uploaded(log, "waiting", ticket, int(env.get("PROJECT_ID", "15")))
    assert [c["method"] for c in calls] == ["PUT", "GET"]
    assert calls[0]["headers"] == calls[1]["headers"]
    writes = events(log, "vcc")
    assert len(writes) == (2 if move else 1)
    comment = writes[0]["args"]
    assert comment[:6] == ["comment", "add", ticket, "--kind", "question", "--text"]
    url = calls[0]["url"]
    expected = ('<p><strong>What this is:</strong> a picture of ' + html.escape('Full <ticket> & "title"') + ', before any code is written.</p>'
                + '<p><strong>Wireframe ready for ' + html.escape('Full <ticket> & "title"') + '.</strong></p>'
                + f'<p><a href="{url}">{url}</a></p>'
                + f'<p>Requested by Valentin in a Claude session, {date.today().isoformat()}.'
                + (f' claude --resume {os.environ["CLAUDE_CODE_SESSION_ID"]}' if os.environ.get("CLAUDE_CODE_SESSION_ID") else '') + '</p>'
                + '<p><span data-type="mention" class="mention" data-id="Valentin Yeo" data-label="name-6">Valentin Yeo</span> '
                + 'Question: <strong>' + html.escape(question) + '</strong></p>'
                + "<p>Yes: it gets built as shown, behind the ticket's flag.</p>"
                + '<p>No: nothing gets built; say what to change.</p>'
                + '<p>My recommendation: Yes. Why: ' + html.escape('It reuses <rows> & "chips".') + '</p>')
    assert comment[6] == expected
    assert comment[7] == "--attach"
    png = Path(comment[8])
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
kit.write_text('<!doctype html><html><head><title>Local kit</title><style>html,body{margin:0;background-color:#1a1d21;color:#ececec;font-family:"IBM Plex Sans",ui-sans-serif,system-ui,sans-serif;font-size:14px}a{color:inherit}button{font:inherit;color:inherit;background-color:#262a30;border:0;border-radius:4px;padding:8px}</style></head><body><a href="#option">Today</a><button onclick="document.getElementById(\'option\').textContent=\'Approved\'">Option</button><p id="option">Wireframe</p></body></html>')
(D / "uploaded").write_bytes(b"remote kit")
p, log = invoke("new", "HTPR-300")
assert [(e["method"], e["url"]) for e in events(log, "http")] == [("GET", "https://hypertask.app/wireframes/base")]
assert (home / "base/base-kit.html").read_bytes() == b"remote kit" == (home / "HTPR-300/index.html").read_bytes()
assert (home / "HTPR-300/base.html").read_bytes() == b"remote kit"
ok("new downloads the published base kit when none is installed")
invoke("base", str(kit))
p, _ = invoke("new", "htpr-255")
assert Path(p.stdout.strip()) == home / "HTPR-255/index.html"
assert Path(p.stdout.strip()).read_bytes() == kit.read_bytes()
assert (home / "HTPR-255/base.html").read_bytes() == kit.read_bytes()
invoke("new", "YPER4-255")
p, _ = invoke("new", "HTPR-255", fail=True)
assert "already exists" in p.stderr
ok("new copies the full kit and its base without overwriting")

for args, message in [((), "--question is required"), (("--question", "Build this"), "must end with"), (("--question", "   "), "must end with"), (("--question", "Build this?"), "--why is required"), (("--question", "Build this?", "--why", "  "), "--why is required")]:
    p, log = invoke("publish", "HTPR-255", *args, fail=True)
    assert message in p.stderr and not log
ok("missing or invalid question fails before any upload or CLI call")

page = home / "HTPR-255/index.html"
record = page.with_name("live-styles.json")
link = f'<a href="{TURL}">HTPR-255</a>'
card = '<div style="font-size:14px;background-color:#262a30;border-radius:4px;padding:8px">Changed card</div>'
valid_page = kit.read_text().replace("<body>", "<body>" + link + card)
styles = [{"sourceUrl": "https://app.hypertask.ai/detail/project-15/6894", "styles": {"outline-width": "1px", "outline-style": "solid"}}]
record.write_text(json.dumps(styles))
add_today(page.parent)
link_message = f"publish refused: add a visible link to {TURL} at the top of <body>, before the main wireframe frame (within the first 200px)"
for content in [
    kit.read_text(),
    '<body>' + TURL + '</body>',
    '<head><link href="' + TURL + '"></head><body>Wireframe</body>',
    '<body><!-- ' + link + ' --><main>Wireframe</main></body>',
    '<body><script type="text/plain">' + link + '</script></body>',
    '<body><template>' + link + '</template></body>',
    '<body>' + link.replace('project-15/255', 'project-15/999') + '</body>',
    '<body>' + link.replace('project-15', 'project-4060') + '</body>',
    '<body><div hidden>' + link + '</div></body>',
    '<style>.hidden{display:none}</style><body><div class="hidden">' + link + '</div></body>',
    '<body><div style="visibility:hidden">' + link + '</div></body>',
    '<body><div style="opacity:0">' + link + '</div></body>',
    '<body>' + link.replace('HTPR-255</a>', '</a>') + '</body>',
    '<body><main>Wireframe</main><footer>' + link + '</footer></body>',
    '<body><div style="height:1000px">Wireframe</div>' + link + '</body>',
]:
    page.write_text(content)
    p, log = invoke("publish", "HTPR-255", "--no-comment", fail=True)
    assert p.stderr.strip() == link_message, p.stderr
    assert not events(log, "http") and not events(log, "vcc") and not events(log, "npx")
ok("absent, wrong-ticket, hidden, empty and late links fail before upload or board writes")

page.write_text(valid_page)
styles_message = f"publish refused: create {record} beside index.html using headless Playwright getComputedStyle on every existing live element as QA user 985; save non-empty JSON entries with sourceUrl on https://app.hypertask.ai and styles (or the HTPR-7724 sourceTicket/themes format)"
for content in [None, '', '{', '{}', '[]', 'null', '[null]', json.dumps([{**styles[0], "invalid": float("nan")}]), json.dumps([{"sourceUrl": TURL}]),
                json.dumps([{"styles": {"color": "red"}}]),
                json.dumps([{"sourceUrl": "https://app.hypertask.ai.evil.test", "styles": {"color": "red"}}]),
                json.dumps([{"sourceUrl": TURL, "styles": {}}]),
                json.dumps([{"sourceUrl": TURL, "styles": {"color": ""}}]),
                json.dumps(styles + [{"sourceUrl": TURL}]),
                json.dumps({"sourceTicket": TURL, "themes": {}}),
                json.dumps({"sourceTicket": TURL, "themes": {"porcelain": {"pinned": {"styles": {}}}}})]:
    record.unlink(missing_ok=True)
    if content is not None:
        record.write_text(content)
    p, log = invoke("publish", "HTPR-255", "--question", "Build this?", "--why", "It reuses live styles.", fail=True)
    assert p.stderr.strip() == styles_message, p.stderr
    assert not events(log, "http") and not events(log, "vcc") and not events(log, "npx")
ok("missing, invalid, empty or incomplete live styles fail before upload or board writes")

record.write_text(json.dumps(styles))
manifest_path = page.with_name("today.json")
manifest = json.loads(manifest_path.read_text())
today_variants = [None, '', '{}', '[]', json.dumps(manifest[:-1]),
                  json.dumps(manifest[:4]),
                  json.dumps(manifest + [manifest[0]]),
                  json.dumps([{**manifest[0], "theme": "midnight"}] + manifest[1:]),
                  json.dumps([{**manifest[0], "viewport": "1024x768"}] + manifest[1:]),
                  json.dumps([{**manifest[0], "sourceUrl": "https://example.test/detail/project-15/255"}] + manifest[1:]),
                  json.dumps([{**manifest[0], "capturedAt": "yesterday"}] + manifest[1:]),
                  json.dumps([{**manifest[0], "file": "today/missing.png"}] + manifest[1:])]
for content in today_variants:
    manifest_path.unlink(missing_ok=True)
    if content is not None:
        manifest_path.write_text(content)
    p, log = invoke("publish", "HTPR-255", "--no-comment", fail=True)
    assert p.stderr.strip() == TODAY, p.stderr
    assert not events(log, "http") and not events(log, "vcc") and not events(log, "npx")
page.write_text(valid_page)
add_today(page.parent)
text = page.read_text()
start = text.index('<section data-wireframe-today')
end = text.index('</section>', start) + len('</section>')
page.write_text(text[:start] + text[end:])
p, log = invoke("publish", "HTPR-255", "--no-comment", fail=True)
assert p.stderr.strip() == TODAY and not events(log, "http")
ok("a Today section missing from the page fails publish")
ok("missing, partial or invalid live capture manifests fail before upload or board writes")

for fixture in ("rejected-ai-chat.html", "rejected-task-entry.html"):
    rejected = (fixtures / fixture).read_text()
    page.write_text(rejected.replace("<body>", "<body>" + link))
    add_today(page.parent)
    p, log = invoke("publish", "HTPR-255", "--no-comment", fail=True)
    assert p.stderr.startswith(TOKENS), p.stderr
    assert not events(log, "http") and not events(log, "vcc") and not events(log, "npx")
ok("both rejected prototypes are refused for using their own fonts, colours, sizes or radii")

page.write_text(valid_page.replace("border-radius:4px", "border-radius:5px"))
add_today(page.parent)
p, log = invoke("publish", "HTPR-255", "--no-comment", fail=True)
assert p.stderr.startswith(TOKENS) and not events(log, "http")
ok("a wireframe that adds an off-token radius is refused")

page.write_text(valid_page.replace('padding:8px">Changed card</div>', 'padding:8px;border:2px solid #ff0000">Changed card</div>'))
add_today(page.parent)
p, log = invoke("publish", "HTPR-255", "--no-comment", fail=True)
assert p.stderr.startswith(TOKENS) and "border" in p.stderr.lower() and not events(log, "http")
ok("a wireframe that adds an off-token border colour is refused")

page.write_text(valid_page.replace('padding:8px">Changed card</div>', 'padding:8px;color:#4455bb">Changed card</div>'))
add_today(page.parent)
p, log = invoke("publish", "HTPR-255", "--no-comment")
assert len(uploaded(log, "waiting")) == 1
ok("a Tailwind design token colour from tailwind.config.ts passes")

page.write_text(valid_page.replace("<body>", '<body style="background-color:#ff0000">'))
add_today(page.parent)
p, log = invoke("publish", "HTPR-255", "--no-comment", fail=True)
assert p.stderr.startswith(TOKENS) and "background" in p.stderr and not events(log, "http")
ok("an off-token body background is refused")

page.write_text(valid_page.replace('padding:8px">Changed card</div>', 'padding:8px;background-image:linear-gradient(#ff0000,#00ff00)">Changed card</div>'))
add_today(page.parent)
p, log = invoke("publish", "HTPR-255", "--no-comment", fail=True)
assert p.stderr.startswith(TOKENS) and "gradient" in p.stderr and not events(log, "http")
ok("an off-token gradient is refused")

live = home / "HTPR-402"
invoke("new", "HTPR-402")
cloned = (kit.read_text().replace("</body>", '<div style="border-radius:5px;background-color:#262a30">Live 5px</div></body>'))
(live / "index.html").write_text(cloned.replace("<body>", "<body>" + link))
(live / "base.html").write_text(cloned)
(live / "live-styles.json").write_text(json.dumps(styles))
add_today(live)
p, log = invoke("publish", "HTPR-402", "--no-comment")
assert len(uploaded(log, "waiting", "HTPR-402")) == 1
ok("copied live CSS radii pass because the token check skips what the base already has")

redo = {"sourceTicket": "https://app.hypertask.ai/detail/project-15/6894", "viewport": {"width": 1440, "height": 900},
        "themes": {"porcelain": {"htmlClass": "light porcelain", "destructive": "0 72.22% 50.59%",
                                 "pinned": {"id": "comment-2", "styles": styles[0]["styles"]},
                                 "normal": {"id": "comment-14", "styles": {"outline-width": "1px"}}}}}
if (D / "live-styles-redo.json").is_file():
    redo = json.loads((D / "live-styles-redo.json").read_text())
page.write_text(valid_page)
add_today(page.parent)
record.write_text(json.dumps(redo))
p, log = invoke("publish", "HTPR-255", "--no-comment")
assert len(uploaded(log, "waiting")) == 1
assert not events(log, "vcc") and not events(log, "npx")
ok("HTPR-7724 redo-shaped header link and sourceTicket/themes record pass through upload stubs")
record.write_text(json.dumps(styles))
other = home / "YPER4-255/index.html"
other.write_text(valid_page.replace("project-15", "project-4060"))
other.with_name("live-styles.json").write_text(json.dumps(styles))
add_today(other.parent)
p, log = invoke("publish", "YPER4-255", "--no-comment", fail=True, PROJECT_ID="99")
assert "https://app.hypertask.ai/detail/project-99/255" in p.stderr
assert not events(log, "http") and not events(log, "vcc")
ok("required link uses resolved ticket coordinates, not a hard-coded board")

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

(home / "HTPR-255/index.html").write_text("unreviewed local edit")
for status in ("waiting", "approved", "rejected"):
    (D / "uploaded").write_bytes(b"published reviewed bytes")
    p, log = invoke("status", "HTPR-255", status)
    calls = events(log, "http")
    assert [c["method"] for c in calls] == ["GET", "PUT"] and not events(log, "vcc") and not events(log, "npx")
    h = {k.lower(): v for k, v in calls[1]["headers"].items()}
    assert h["x-status"] == status and h["x-ticket-url"] == "https://app.hypertask.ai/detail/project-15/255"
    assert (D / "uploaded").read_bytes() == b"published reviewed bytes"
ok("status re-uploads the published bytes, never the local file, with original ticket headers")
p, log = invoke("status", "HTPR-999", "approved", fail=True, FAIL_HTTP="GET")
assert "stub HTTP failure" in p.stderr and [e["method"] for e in events(log, "http")] == ["GET"]
p, log = invoke("status", "HTPR-255", "invalid", fail=True)
assert "invalid choice" in p.stderr and not log
ok("status of an unpublished wireframe or an invalid state never uploads")
page.write_text(valid_page)
add_today(page.parent)

app = D / "app"
app.mkdir()
(app / "screen.html").write_text((fixtures / "live-screen.html").read_text())
invoke("new", "HTPR-400")
(app_page := home / "HTPR-400/index.html").write_text(app_page.read_text().replace("<body>", "<body>" + link))
(app_page.parent / "live-styles.json").write_text(json.dumps(styles))
p, log = invoke("capture", "HTPR-400", "/screen.html", WIREFRAME_APP_BASE=f"file://{app}", WIREFRAME_QA_STATE="")
manifest = json.loads((app_page.parent / "today.json").read_text())
assert len(manifest) == 8 and {(e["theme"], e["viewport"]) for e in manifest} == {(t, v) for t in ("porcelain", "graphite", "amoled", "dia") for v in ("390x844", "1440x900")}
assert all((app_page.parent / e["file"]).read_bytes()[:8] == b"\x89PNG\r\n\x1a\n" for e in manifest)
assert app_page.read_text().count('data-capture="') == 8
p, log = invoke("publish", "HTPR-400", "--no-comment", WIREFRAME_APP_BASE=f"file://{app}")
assert len(uploaded(log, "waiting", "HTPR-400")) == 1
ok("capture takes eight live screenshots, writes today.json and the page publishes from the base kit")

invoke("new", "HTPR-401", "--mobile", "/screen.html", WIREFRAME_APP_BASE=f"file://{app}", WIREFRAME_QA_STATE="")
cloned = home / "HTPR-401/index.html"
body = cloned.read_text()
assert (home / "HTPR-401/base.html").read_text() == body
assert "<script" not in body.lower()
assert f'href="{TURL}"' in body and "HTPR-401" in body
assert "Live task entry" in body
(cloned.parent / "live-styles.json").write_text(json.dumps(styles))
add_today(cloned.parent)
p, log = invoke("publish", "HTPR-401", "--no-comment")
assert len(uploaded(log, "waiting", "HTPR-401")) == 1
ok("new --mobile clones the live phone page, strips scripts, adds the ticket link and publishes")

p, log = invoke("publish", "BASE")
assert len(uploaded(log, "waiting", "BASE", 4060)) == 1
assert not events(log, "vcc") and not events(log, "hypertask") and not events(log, "npx")
ok("BASE uploads only and links to project-4060/255")

for env, message in [({"FAIL_HTTP": "PUT"}, "stub HTTP failure"), ({"FAIL_HTTP": "GET"}, "stub HTTP failure"), ({"MISMATCH": "1"}, "upload verification failed"), ({"FAIL_SCREENSHOT": "1"}, "returned non-zero"), ({"NO_SCREENSHOT": "1"}, "no PNG captured")]:
    p, log = invoke("publish", "HTPR-255", "--question", "Build this?", "--why", "It is plain.", fail=True, **env)
    assert message in p.stderr and not events(log, "vcc")
    if "FAIL_SCREENSHOT" not in env and "NO_SCREENSHOT" not in env:
        assert not events(log, "npx")
ok("upload, verification and screenshot failures prevent comments and moves")
p, log = invoke("publish", "HTPR-255", "--question", "Build this?", "--why", "It is plain.", fail=True, FAIL_VCC="comment")
assert len(events(log, "vcc")) == 1
p, log = invoke("publish", "HTPR-255", "--question", "Build this?", "--why", "It is plain.", fail=True, FAIL_VCC="task")
assert len(events(log, "vcc")) == 2
p, log = invoke("publish", "HTPR-255", "--no-comment", fail=True, FAIL_TICKET="1")
assert "cannot read ticket" in p.stderr and not events(log, "http")
ok("CLI failures are loud and a failed comment never moves the ticket")

print(f"{passes} passed, 0 failed")
PY
