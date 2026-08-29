#!/usr/bin/env python3
"""File each Strix finding as a Hypertask ticket on board 15.

Usage: strix-file-tickets.py <strix_run_dir>

Dedupes against tickets already filed by an earlier run by matching the
finding title. Posts through the Hetzner hop: the Contabo IP is
Cloudflare-403'd on api.hypertask.ai (HTPR-4784).
"""
import html
import json
import os
import re
import subprocess
import sys

RUN = sys.argv[1].rstrip("/")
PROJECT = 15
BUGS_SECTION = 4389
STATE = os.path.expanduser("~/.cache/strix-filed-titles.json")
API = "https://api.hypertask.ai/api/mcp/tasks/create"


def post_ticket(payload):
    """POST a task via the Hetzner hop. Returns True on HTTP 200."""
    token = json.load(open(os.path.expanduser("~/.hypertask/config.json")))["token"]
    body = json.dumps(payload)
    remote = (
        f"cat > /tmp/strix-task.json <<'JSONEOF'\n{body}\nJSONEOF\n"
        f"curl -sS -o /dev/null -w '%{{http_code}}' -X POST "
        f"-H 'Authorization: Bearer {token}' -H 'Content-Type: application/json' "
        f"--data @/tmp/strix-task.json '{API}'"
    )
    r = subprocess.run(["ssh", "vps", "bash", "-s"], input=remote,
                       capture_output=True, text=True)
    return r.stdout.strip().endswith("200")


def norm(t):
    return re.sub(r"[^a-z0-9]+", "", (t or "").lower())


def esc(s):
    return html.escape((s or "").strip())


def main():
    path = os.path.join(RUN, "vulnerabilities.json")
    if not os.path.exists(path):
        print("no vulnerabilities.json, nothing to file")
        return
    vulns = json.load(open(path))
    if not isinstance(vulns, list):
        vulns = vulns.get("vulnerabilities", [])

    filed = set()
    if os.path.exists(STATE):
        filed = set(json.load(open(STATE)))

    new = 0
    for v in vulns:
        title = v.get("title") or v.get("id")
        key = norm(title)
        if key in filed:
            print("skip (already filed):", title)
            continue
        sev = (v.get("severity") or "medium").lower()
        if sev in ("info", "informational", "low"):
            print("skip (low severity):", title)
            continue

        desc = (
            f"<p><strong>Strix found this: {esc(v.get('impact', ''))[:300]}</strong></p>"
            f"<p>{esc(v.get('description', ''))}</p>"
            f"<p><strong>Severity:</strong> {esc(sev)} &middot; "
            f"<strong>Found:</strong> {esc(v.get('timestamp', ''))}</p>"
            f"<p><strong>Technical detail</strong></p>"
            f"<p>{esc(v.get('technical_analysis', ''))[:3000]}</p>"
            f"<p><strong>Reproduction</strong></p>"
            f"<p>{esc(json.dumps(v.get('reproduction') or v.get('proof_of_concept') or ''))[:2000]}</p>"
            f"<p>Automated weekly Strix pentest. Run dir on the VPS: <code>{esc(RUN)}</code></p>"
        )

        ok = post_ticket({
            "project_id": PROJECT,
            "sectionId": BUGS_SECTION,
            "title": f"Security ({sev}): {title}"[:120],
            "description": desc,
            "assignee": [6],
        })
        if not ok:
            print("FAILED to file:", title)
            continue
        print("filed:", title)
        filed.add(key)
        new += 1

    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    json.dump(sorted(filed), open(STATE, "w"))
    print(f"{new} new ticket(s) filed, {len(vulns)} finding(s) in run")


if __name__ == "__main__":
    main()
