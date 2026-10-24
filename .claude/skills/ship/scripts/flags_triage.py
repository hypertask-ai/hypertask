"""Label the daily Flags snapshot using the shared live flag matcher."""
import html
import json
import re
import subprocess

from ticket_flags import read_flags, ticket_flags

STATE_LABELS = {
    "EVERYONE": "flag:everyone",
    "OWNER_ONLY": "flag:owner-only",
    "OWNER_AND_QA": "flag:qa-only",
    "OFF": "flag:off",
}
LABELS = set(STATE_LABELS.values()) | {"flag:internal"}
CLARIFICATION = "Flags triage: Please declare the flag key and current state on this ticket."


def command(*args):
    result = json.loads(subprocess.check_output(["vcc", *args, "--json"], text=True))
    if result.get("success") is not True:
        raise ValueError(f"vcc {' '.join(args[:2])} failed")
    return result


def pages(field, *args):
    rows, cursors = [], set()
    cursor = None
    while True:
        result = command(*args, "--limit", "100", *(["--cursor", cursor] if cursor else []))
        if not isinstance(result.get(field), list):
            raise ValueError(f"cannot read {field}")
        rows.extend(result[field])
        cursor = result.get("nextCursor")
        if not cursor:
            if result.get("has_more") or ("total" in result and len(rows) != result["total"]):
                raise ValueError(f"incomplete {field} list")
            return rows
        if cursor in cursors:
            raise ValueError(f"repeated {field} cursor")
        cursors.add(cursor)


def inspect_ticket(task, flags, comments):
    ticket = task["ticketNumber"]
    description = task.get("description") or ""
    has_question = any(CLARIFICATION in (c.get("text") or c.get("commentText") or "") for c in comments)
    issues = []
    try:
        declared = ticket_flags(ticket, flags, description, include_owned=False)
        candidates = declared or ticket_flags(ticket, flags, ticket_url=task.get("url"))
        if not candidates:
            candidates = ticket_flags(ticket, flags, "\n".join(
                c.get("text") or c.get("commentText") or "" for c in comments), include_owned=False)
    except ValueError as error:
        return {"issues": [str(error)], "ask": not has_question, "label": None}
    ask = not declared and not has_question
    if not declared:
        issues.append("No declared live flag key in the description")
    if len(candidates) != 1:
        issues.append("Multiple flag keys; declare one governing flag" if candidates else "Cannot resolve one live flag")
        return {"issues": issues, "ask": not has_question, "label": None}
    flag = candidates[0]
    label = "flag:internal" if flag.get("kind") == "internal" else STATE_LABELS[flag["mode"]]
    current = [entry["name"] for entry in (task.get("labels") or []) if entry["name"] in LABELS]
    if current != [label]:
        issues.append(f"Expected exactly one state label: {label}")
    url = "https://app.hypertask.ai/admin/flags/" + flag["key"]
    links = re.findall(r"\bhref\s*=\s*[\"']([^\"']+)[\"']", description, re.IGNORECASE)
    add_link = url not in links and "/admin/flags/" + flag["key"] not in links
    if add_link:
        issues.append(f"Missing flag card link: {url}")
    return {"issues": issues, "ask": ask, "label": label, "url": url, "key": flag["key"], "add_link": add_link}


def current_task(ticket):
    result = command("task", "get", ticket)
    if len(result["tasks"]) != 1 or result["tasks"][0]["ticketNumber"] != ticket:
        raise ValueError(f"cannot read current ticket {ticket}")
    return result["tasks"][0]


def in_flags(task):
    return task["section"] == "Flags" and task.get("projectId", 15) == 15 and task.get("status", "Normal") == "Normal"


def triage(task, go, board_labels):
    ticket = task["ticketNumber"]
    comments = pages("comments", "comment", "list", ticket)
    inspection = inspect_ticket(task, read_flags(), comments)
    if go and inspection["issues"]:
        task = current_task(ticket)
        if not in_flags(task):
            print(f"ht-flags-sweep: leave {ticket}: no longer in Flags")
            return None
        inspection = inspect_ticket(task, read_flags(), pages("comments", "comment", "list", ticket))
        if inspection["ask"]:
            command("comment", "add", ticket, "--text", f"<p>{CLARIFICATION}</p>")
        label = inspection["label"]
        if label:
            if not board_labels:
                board_labels.update({entry["name"] for entry in pages("labels", "labels", "list", "--project", "15")})
            if label not in board_labels:
                command("labels", "create", "--project", "15", "--name", label)
                board_labels.add(label)
            args = ["task", "update", ticket, "--project", "15"]
            names = [entry["name"] for entry in (task.get("labels") or [])]
            stale = [name for name in names if name in LABELS and name != label]
            if stale:
                args.extend(["--remove-labels", ",".join(stale)])
            if label not in names:
                args.extend(["--add-label", label])
            if inspection["add_link"]:
                link = f'<p>Flag: <a href="{html.escape(inspection["url"], quote=True)}">{html.escape(inspection["key"])}</a></p>'
                description = task.get("description") or ""
                if re.search(r"</body\s*>", description, re.IGNORECASE):
                    description = re.sub(r"</body\s*>", lambda match: link + match[0], description, count=1, flags=re.IGNORECASE)
                else:
                    description += "\n" + link
                args.extend(["--description", description])
            if len(args) > 5:
                command(*args)
            task = current_task(ticket)
            if not in_flags(task):
                print(f"ht-flags-sweep: leave {ticket}: no longer in Flags")
                return None
            inspection = inspect_ticket(task, read_flags(), pages("comments", "comment", "list", ticket))
            if inspection["issues"]:
                raise ValueError(f"{ticket} flag labelling did not persist: {'; '.join(inspection['issues'])}")
    if inspection["issues"]:
        print(f"ht-flags-sweep: {ticket} triage: {'; '.join(inspection['issues'])}")
    return task
