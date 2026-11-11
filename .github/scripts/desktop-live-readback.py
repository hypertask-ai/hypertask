#!/usr/bin/env python3
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

APP = "https://app.hypertask.ai"
DESKTOP_SHA = "13b5fc7d2795fe59b30463001fe8d32c8b3f1802"
SANDBOX_BOARD_ID = 7049
SANDBOX_TITLE = "QA Sandbox"
FORBIDDEN_BOARDS = {15, 4060}
MARKERS = ("BOARD_READBACK", "TASK_READBACK", "INBOX_READBACK", "LIVE_READBACK_OK")
CHILD_ENV_KEYS = (
    "PATH",
    "HOME",
    "LANG",
    "LC_ALL",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "TMPDIR",
    "SYSTEMROOT",
)

def fail(message):
    print(f"::error::{message}")
    raise SystemExit(1)

def production_dispatch(ref):
    return ref == "refs/heads/production"

def mask(value):
    if value:
        print(f"::add-mask::{value}")

def request(method, url, body=None, headers=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.headers, error.read()

def cookie_header(headers):
    values = headers.get_all("Set-Cookie") if hasattr(headers, "get_all") else None
    if not values:
        single = headers.get("Set-Cookie")
        values = [single] if single else []
    pairs = []
    for item in values:
        pair = item.split(";", 1)[0].strip()
        if "=" in pair:
            pairs.append(pair)
    return "; ".join(pairs)

def redact(text, secrets):
    for secret in secrets:
        if secret:
            text = text.replace(secret, "[redacted]")
    return text

def safe_lines(text):
    kept = []
    for line in text.splitlines():
        if any(marker in line for marker in (*MARKERS, "LIVE_READBACK", "INBOX_EMPTY", "API ", "cli ", "queued", "SystemExit")):
            kept.append(line[:300])
    return "\n".join(kept[-40:])

def contains_id(value, wanted):
    if isinstance(value, dict):
        if value.get("id") == wanted:
            return True
        return any(contains_id(item, wanted) for item in value.values())
    if isinstance(value, list):
        return any(contains_id(item, wanted) for item in value)
    return False

def choose_board(projects):
    if not isinstance(projects, list):
        return None
    for project in projects:
        if not isinstance(project, dict):
            continue
        if project.get("status") != "Normal":
            continue
        project_id = project.get("id")
        if not isinstance(project_id, int) or project_id in FORBIDDEN_BOARDS:
            continue
        if project_id == SANDBOX_BOARD_ID and project.get("title") == SANDBOX_TITLE:
            return str(project_id)
    return None

def self_check():
    archived = [{"id": 2069, "title": "Old board", "status": "Archive"}]
    if choose_board(archived) is not None:
        fail("archived board was selected")
    foreign = [{"id": 2069, "title": SANDBOX_TITLE, "status": "Normal"}]
    if choose_board(foreign) is not None:
        fail("non-sandbox board was selected")
    production = [{"id": 15, "title": SANDBOX_TITLE, "status": "Normal"}]
    if choose_board(production) is not None:
        fail("production board was selected")
    wrong_title = [{"id": SANDBOX_BOARD_ID, "title": "Other", "status": "Normal"}]
    if choose_board(wrong_title) is not None:
        fail("renamed sandbox was selected")
    sandbox = [{"id": SANDBOX_BOARD_ID, "title": SANDBOX_TITLE, "status": "Normal"}]
    if choose_board(sandbox) != str(SANDBOX_BOARD_ID):
        fail("QA sandbox was not selected")
    deleted = json.dumps({"success": True, "tasks": [{"id": 1, "status": "Deleted"}]}).encode()
    if task_still_present(200, deleted, "1"):
        fail("deleted task counted as present")
    live = json.dumps({"success": True, "tasks": [{"id": 1, "status": "Normal"}]}).encode()
    if not task_still_present(200, live, "1"):
        fail("live task counted as cleaned")
    archived = json.dumps({"success": True, "task": {"id": 9, "status": "Archive"}}).encode()
    if not task_still_present(200, archived, "9"):
        fail("archived task counted as cleaned")
    missing = json.dumps({"success": False}).encode()
    if task_still_present(404, missing, "1"):
        fail("missing task counted as present")
    if production_dispatch("refs/heads/runner-2/hyci-258"):
        fail("branch dispatch was accepted")
    if not production_dispatch("refs/heads/production"):
        fail("production dispatch was refused")
    print("PRODUCTION_REF_OK")
    print("CLEANUP_STATUS_OK")
    env = {key: os.environ[key] for key in CHILD_ENV_KEYS if key in os.environ}
    env["QA_LOGIN_EMAIL"] = ""
    env["QA_LOGIN_PASSWORD"] = ""
    proc = subprocess.run(
        [sys.executable, __file__],
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    output = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode == 0 or "not tested: QA login is missing" not in output:
        fail("missing login did not fail closed")
    print("board selection passed")

def matching_task(payload, task_id):
    task = payload.get("task")
    if isinstance(task, dict) and str(task.get("id")) == task_id:
        return task
    tasks = payload.get("tasks")
    if isinstance(tasks, list):
        for item in tasks:
            if isinstance(item, dict) and str(item.get("id")) == task_id:
                return item
    return None

def task_still_present(status, raw, task_id):
    if status == 404:
        return False
    try:
        payload = json.loads(raw.decode())
    except json.JSONDecodeError:
        return True
    if not isinstance(payload, dict) or payload.get("success") is False:
        return False
    task = matching_task(payload, task_id)
    if task is None:
        return False
    return task.get("status") != "Deleted"

def sandbox_board(token):
    offset = 0
    while offset <= 300:
        query = urllib.parse.urlencode({
            "status": "Normal",
            "search": SANDBOX_TITLE,
            "limit": "100",
            "offset": str(offset),
        })
        status, _, raw = request(
            "GET",
            APP + "/api/mcp/projects?" + query,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
            },
        )
        if status != 200:
            fail(f"board list failed with status {status}")
        try:
            payload = json.loads(raw.decode())
        except json.JSONDecodeError:
            fail("board list returned a non-JSON body")
        projects = payload.get("projects") if isinstance(payload, dict) else None
        if not isinstance(projects, list):
            fail("board list returned no projects")
        chosen = choose_board(projects)
        if chosen:
            return chosen
        if not projects or not payload.get("nextCursor"):
            break
        offset += len(projects)
    fail("QA sandbox board is not available")

def main():
    if "--self-check" in sys.argv[1:]:
        self_check()
        return
    email = os.environ.get("QA_LOGIN_EMAIL", "")
    password = os.environ.get("QA_LOGIN_PASSWORD", "")
    if not email or not password:
        fail("not tested: QA login is missing")
    if not production_dispatch(os.environ.get("GITHUB_REF", "")):
        fail("desktop readback runs only from production")
    status, headers, raw = request(
        "POST",
        APP + "/api/auth/qa-login",
        {"email": email, "password": password},
        {"Content-Type": "application/json", "Accept": "application/json"},
    )
    if status != 200:
        fail(f"QA login failed with status {status}")
    try:
        payload = json.loads(raw.decode())
    except json.JSONDecodeError:
        fail("QA login returned a non-JSON body")
    if not isinstance(payload, dict) or payload.get("success") is not True:
        fail("QA login refused")
    session = cookie_header(headers)
    if not session:
        fail("QA login returned no session")
    mask(session)
    status, _, raw = request(
        "POST",
        APP + "/api/mcp/token",
        {},
        {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Cookie": session,
        },
    )
    if status != 200:
        fail(f"MCP token mint failed with status {status}")
    try:
        minted = json.loads(raw.decode())
    except json.JSONDecodeError:
        fail("MCP token mint returned a non-JSON body")
    token = minted.get("token") if isinstance(minted, dict) else None
    if not isinstance(token, str) or len(token) < 20:
        fail("MCP token mint returned no token")
    mask(token)
    board = sandbox_board(token)
    print(f"API board {board}")
    cli = os.path.abspath("desktop/target/release/ht-core-cli")
    script = os.path.abspath("desktop/gates/live-readback.py")
    if not os.path.isfile(cli) or not os.path.isfile(script):
        fail("desktop core or readback script is missing")
    revision = subprocess.run(
        ["git", "-C", "desktop", "rev-parse", "HEAD"],
        text=True,
        capture_output=True,
        check=False,
    )
    if revision.stdout.strip() != DESKTOP_SHA:
        fail("desktop checkout is not the reviewed commit")
    child = {key: os.environ[key] for key in CHILD_ENV_KEYS if key in os.environ}
    child["HT_TOKEN"] = token
    child["HT_BOARD"] = board
    child["HT_CORE_CLI"] = cli
    proc = subprocess.run(
        [sys.executable, script],
        cwd="desktop",
        env=child,
        text=True,
        capture_output=True,
        check=False,
    )
    output = redact((proc.stdout or "") + (proc.stderr or ""), (token, password, email, session))
    printed = safe_lines(output)
    if printed:
        print(printed)
    if proc.returncode != 0:
        fail(f"desktop readback exited {proc.returncode}")
    for marker in MARKERS:
        if marker not in output:
            fail(f"missing {marker}")
    task_ids = re.findall(r"BOARD_READBACK task (\d+)", output)
    note_ids = re.findall(r"INBOX_READBACK notification (\d+)", output)
    if len(task_ids) != 1 or len(note_ids) != 1:
        fail("readback ids were not singular")
    task_id, note_id = task_ids[0], note_ids[0]
    def api(method, path):
        return request(
            method,
            APP + "/api/mcp" + path,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
        )
    status, _, raw = api("GET", f"/tasks?task_id={task_id}")
    if task_still_present(status, raw, task_id):
        seen = ""
        try:
            match = matching_task(json.loads(raw.decode()), task_id)
            if isinstance(match, dict) and isinstance(match.get("status"), str):
                seen = match["status"]
        except json.JSONDecodeError:
            seen = ""
        fail("temporary task still exists" + (f" status {seen}" if seen else ""))
    status, _, raw = api("GET", "/inbox/list")
    if status != 200:
        fail(f"inbox cleanup check status {status}")
    try:
        listing = json.loads(raw.decode())
    except json.JSONDecodeError:
        fail("inbox cleanup check was not JSON")
    if not contains_id(listing, int(note_id)):
        fail("archived inbox row was not restored")
    print("TASK_CLEANED")
    print("INBOX_RESTORED")
    print("DESKTOP_READBACK_PASSED")

if __name__ == "__main__":
    main()
