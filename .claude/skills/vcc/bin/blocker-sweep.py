#!/usr/bin/env python3
import argparse
import html
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys


def cli(*args):
    result = subprocess.run(
        [os.environ.get("VCC_BIN", "vcc"), *args, "--json"],
        capture_output=True, text=True, timeout=60, check=True,
    )
    data = json.loads(result.stdout)
    if data.get("success") is not True:
        raise ValueError("board read failed")
    return data


def marked_question(ticket, project=None):
    scope = ["--project", project] if project else []
    task = cli("task", "get", ticket, *scope)["tasks"][0]
    marked = task.get("blockerCommentId")
    if not marked:
        return task, None
    offset = 0
    while True:
        page = cli("comments", "list", ticket, *scope, "--limit", "100", "--offset", str(offset))
        for comment in page["comments"]:
            if str(comment["id"]) == str(marked):
                if not re.search(r"^\s*(?:Valentin Yeo\s+)?Question:\s*.+\?", plain(comment.get("text", "")), re.M):
                    raise ValueError("marked comment is not a Question")
                return task, comment
        if not page.get("nextCursor") and len(page["comments"]) < 100:
            raise ValueError("marked Question is unavailable")
        offset += len(page["comments"])
        if not page["comments"]:
            raise ValueError("empty comment page")


def plain(text):
    text = re.sub(r"</(?:p|li|div)>|<br\s*/?>", "\n", text, flags=re.I)
    return html.unescape(re.sub(r"<[^>]+>", " ", text))


def approved(question):
    if not re.search(r"\bMy recommendation:\s*Yes\b", plain(question.get("text", "")), re.I):
        return False
    return any(
        (reaction.get("userId") or (reaction.get("user") or {}).get("id")) == 6
        and not any(reaction.get(key) for key in ("agent", "agentId", "agentDisplayName", "isAgent", "isDeleted"))
        and re.fullmatch("👍[\U0001f3fb-\U0001f3ff]?", reaction.get("emoji", ""))
        and reaction.get("createdAt", "") > question.get("createdAt", "")
        and reaction.get("createdAt", "") > (question.get("editedAt") or "")
        for reaction in question.get("reactions") or []
    )


def install():
    home = Path.home()
    identity = subprocess.run([str(home / ".agents/skills/ship/scripts/ship-identity")], capture_output=True, text=True, check=True).stdout.split("\t", 1)[0]
    if not os.environ.get("SHIP_SESSION_NAME") or identity != os.environ["SHIP_SESSION_NAME"]:
        raise ValueError("installer needs this session's verified board identity")
    config = home / ".config/hypertask-agents/blocker-sweep.env"
    content = "SHIP_SESSION_NAME=" + json.dumps(identity) + "\n"
    if config.exists() and config.read_text() != content:
        raise ValueError("a different identity already owns the blocker sweep")
    target = home / ".local/lib/hypertask/blocker-sweep.py"
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(__file__, target)
    config.parent.mkdir(parents=True, exist_ok=True)
    config.write_text(content)
    units = home / ".config/systemd/user"
    units.mkdir(parents=True, exist_ok=True)
    paths = []
    for name in ("vcc-blocker-sweep.service", "vcc-blocker-sweep.timer"):
        dest = units / name
        shutil.copyfile(Path(__file__).resolve().parents[3] / "systemd" / name, dest)
        paths.append(str(dest))
    subprocess.run([str(home / ".agents/skills/ship/scripts/user-unit-check"), *paths], check=True)
    subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "--user", "enable", "--now", "vcc-blocker-sweep.timer"], check=True)
    subprocess.run([str(home / ".agents/skills/ship/scripts/user-unit-check"), "--first-run", "vcc-blocker-sweep.service"], check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("check", "sweep", "install"))
    parser.add_argument("targets", nargs="*")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--project")
    args = parser.parse_args()
    if args.command == "install":
        install()
        return
    if not args.targets:
        parser.error("provide ticket or board targets")
    if args.command == "check":
        _, question = marked_question(args.targets[0], args.project)
        if question is None:
            raise ValueError("no marked Question")
        print(question["text"])
        return
    source = Path(os.environ.get("VCC_BLOCKER_SOURCE", str(Path.home() / ".local/share/house-rules/skills/tickets/scripts/blocker-sweep.py")))
    scan = subprocess.run([sys.executable, str(source), *args.targets], capture_output=True, text=True, timeout=240, check=True)
    for row in scan.stdout.splitlines():
        parts = row.split("\t")
        if len(parts) < 4 or parts[0] != "ANSWERED":
            continue
        ticket = parts[1]
        task, question = marked_question(ticket)
        if question is None or str(task["blockerCommentId"]) != parts[3].removeprefix("comment ") or not approved(question):
            continue
        if args.apply:
            subprocess.run([os.environ.get("VCC_BIN", "vcc"), "task", "waiting-on", ticket, "--user", "none"], check=True, timeout=60)
            after = cli("task", "get", ticket)["tasks"][0]
            if after.get("blockerCommentId") is not None:
                raise ValueError(f"{ticket}: blocker was not cleared")
            subprocess.run([
                os.environ.get("VCC_BIN", "vcc"), "activity", "add", ticket,
                f"Cleared waiting-on and marked Question {question['id']}: Valentin approved the Yes recommendation with 👍. No release or flag change performed.",
            ], check=True, timeout=60)
        print(f"{'CLEARED' if args.apply else 'APPROVED'}\t{ticket}\t{question['id']}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, IndexError, subprocess.SubprocessError) as error:
        print(f"blocker-sweep: {error}", file=sys.stderr)
        sys.exit(1)
