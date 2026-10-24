#!/usr/bin/env python3
"""Match ticket-owned and explicitly referenced flags against live modes."""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
KEY = re.compile(r"(?<![a-z0-9-])(?:htpr|yper4|hyfa)-[1-9]\d*(?:-[a-z0-9]+)+(?![a-z0-9-])")
MODES = {"EVERYONE", "OWNER_AND_QA", "OWNER_ONLY", "OFF"}


def read_flags():
    data = json.loads(subprocess.check_output([os.environ.get("HT_FLAG_BIN", str(HERE / "ht-flag")), "get"], text=True))
    return validate_flags(data["flags"])


def validate_flags(flags):
    if not isinstance(flags, list) or any(
        not isinstance(f, dict) or not isinstance(f.get("key"), str)
        or f.get("mode") not in MODES for f in flags
    ) or len({f["key"] for f in flags}) != len(flags):
        raise ValueError("invalid live flag list")
    return flags


def ticket_flags(ticket, flags, references=""):
    validate_flags(flags)
    if not re.fullmatch(r"(?:HTPR|YPER4|HYFA)-[1-9]\d*", ticket):
        raise ValueError("invalid ticket number")
    prefix = ticket.lower()
    keys = {f["key"] for f in flags if f.get("ticketId") == ticket
            or f["key"] == prefix or f["key"].startswith(prefix + "-")}
    keys.update(KEY.findall(references.lower()))
    # Non-ticket-named legacy flags can still be explicitly referenced.
    keys.update(f["key"] for f in flags if re.search(
        r"(?<![a-z0-9-])" + re.escape(f["key"]) + r"(?![a-z0-9-])", references))
    by_key = {f["key"]: f for f in flags}
    missing = keys - by_key.keys()
    if missing:
        raise ValueError("cannot read live mode for " + ", ".join(sorted(missing)))
    return [by_key[key] for key in sorted(keys)]


def require_everyone(ticket, flags, references="", require_flags=False):
    matched = ticket_flags(ticket, flags, references)
    if require_flags and not matched:
        raise ValueError(f"{ticket} has no identifiable flags; leave it in Flags")
    pending = [f'{f["key"]}={f["mode"]}' for f in matched if f["mode"] != "EVERYONE"]
    if pending:
        raise ValueError("flags are not Everyone: " + ", ".join(pending) + "; move to Flags after live QA")
    return matched


def main():
    ticket, repo, pr = sys.argv[1:]
    try:
        current = json.loads(subprocess.check_output([
            "hypertask", "tasks", "get", ticket, "--json"], text=True))
        if current.get("success") is not True or len(current["tasks"]) != 1:
            raise ValueError("invalid ticket response")
        references = current["tasks"][0].get("description", "")
        if references is None:
            references = ""
        if not isinstance(references, str):
            raise ValueError("invalid ticket description")
    except (ValueError, KeyError, TypeError, AttributeError, OSError, subprocess.SubprocessError) as error:
        raise ValueError(f"cannot read current ticket {ticket}") from error
    if pr:
        body = subprocess.check_output([
            "gh", "pr", "view", pr, "-R", repo, "--json", "body", "--jq", ".body"], text=True)
        references += "\n" + "\n".join(re.findall(
            r"https://app\.hypertask\.ai/admin/flags/[a-z0-9-]+|"
            r"^\s*(?:feature flag|flag):[^\n]+", body, re.MULTILINE | re.IGNORECASE))
        pages = subprocess.check_output([
            "gh", "api", f"repos/{repo}/pulls/{pr}/files?per_page=100", "--paginate", "--slurp"], text=True)
        pages = json.loads(pages)
        if not isinstance(pages, list) or not all(isinstance(page, list) for page in pages):
            raise ValueError("cannot read PR flag references")
        for page in pages:
            for file in page:
                path = file["filename"]
                if file.get("status") == "removed" or not path.startswith("src/") or re.search(
                    r"(?:^|/)(?:__tests__|__mocks__|fixtures|tests|docs)/|\.(?:test|spec)\.", path
                ):
                    continue
                if path.startswith("src/lib/flags/definitions/") and path.endswith(".ts"):
                    references += "\n" + path
                else:
                    added = "\n".join(line[1:] for line in file.get("patch", "").splitlines()
                                      if line.startswith("+") and not line.startswith("+++"))
                    references += "\n" + "\n".join(re.findall(
                        r"\b(?:useFlag(?:Loaded|Ready)?|isFeatureEnabled|defaultFeatureFlagMode)"
                        r"\s*\(\s*['\"]([a-z0-9-]+)['\"]", added))
                    references += "\n" + "\n".join(re.findall(
                        r"\b(?:from|import)\s*['\"][^'\"]*lib/flags/definitions/([^'\"]+)['\"]", added))
    require_everyone(ticket, read_flags(), references)
    print("flags ok (Everyone or no ticket flag)")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as error:
        print(f"cannot complete {sys.argv[1]}: {error}; live flag modes must be readable before Done", file=sys.stderr)
        sys.exit(1)
