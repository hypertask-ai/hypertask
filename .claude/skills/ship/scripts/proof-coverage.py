#!/usr/bin/env python3
import html
import json
import os
import re
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path

ACCEPTANCE = {
    "done when", "done means", "acceptance", "acceptance criteria",
    "akzeptanzkriterien", "critères d'acceptation", "critères d’acceptation",
    "criterios de aceptación", "acceptatiecriteria",
}
NON_ACCEPTANCE = re.compile(r"^(related|risk|undo|flag|evidence|note|problem|fix|now|cost|blocker)\s*:", re.I)
ROW = re.compile(r"^-\s+(PASS|FAIL|UNREACHABLE)\s*:\s*(.*?)\s*->\s*(.*?)\s*$")
HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
BULLET = re.compile(r"^\s*[-*+]\s+(?:\[[ xX]\]\s*)?")
RUN = re.compile(r"^Run: ([0-9]{4}-[0-9]{2}-[0-9]{2}-qa-run-[0-9]+)\s*$", re.M)
PAGE = re.compile(r"^Feature map: (\.claude/skills/verify-qa/reference/feature-map/[a-z0-9-]+\.md)\s*$", re.M)


def norm(text):
    text = html.unescape(re.sub(r"<[^>]+>", " ", text or ""))
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"[`*_#]", "", text)
    return re.sub(r"\s+", " ", text).strip().rstrip(".")


class Blocks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.blocks, self.buf, self.tag = [], "", None

    def flush(self):
        text = norm(self.buf)
        if text:
            self.blocks.append((self.tag or "para", text))
        self.buf, self.tag = "", None

    def handle_starttag(self, tag, attrs):
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.flush()
            self.tag = "heading"
        elif tag == "li":
            self.flush()
            self.tag = "bullet"
        elif tag in ("p", "div", "br", "blockquote"):
            if self.tag in ("bullet", "heading"):
                self.buf += " "
            else:
                self.flush()
                self.tag = "para"

    def handle_endtag(self, tag):
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6", "li", "p", "div", "blockquote"):
            if self.tag in ("heading", "para", "bullet"):
                self.flush()

    def handle_data(self, data):
        self.buf += data


def acceptance_items(source):
    parser = Blocks()
    parser.feed(source or "")
    parser.flush()
    active, items = False, []
    for kind, text in parser.blocks:
        head, sep, tail = text.partition(":")
        if sep and head.lower().strip() in ACCEPTANCE and tail.strip():
            active = True
            if not NON_ACCEPTANCE.match(tail.strip()):
                items.append(tail.strip())
            continue
        if text.lower().rstrip(":") in ACCEPTANCE:
            active = True
            continue
        if kind == "heading":
            active = False
            continue
        if kind == "para":
            if active and not NON_ACCEPTANCE.match(text):
                items.append(text)
            continue
        if active and not NON_ACCEPTANCE.match(text):
            items.append(text)
    return list(dict.fromkeys(items))


def gotcha_items(markdown):
    active, items = False, []
    for line in (markdown or "").splitlines():
        heading = HEADING.match(line)
        if heading:
            active = norm(heading.group(2)).lower().rstrip(":") in {"gotchas", "what usually breaks"}
            continue
        if not active:
            continue
        if BULLET.match(line):
            items.append(norm(BULLET.sub("", line, count=1)))
        elif items and line.startswith("  ") and line.strip():
            items[-1] = norm(items[-1] + " " + line)
    return [item for item in dict.fromkeys(items) if item]


def section_rows(proof_text, section):
    block = re.search(rf"^##\s+{re.escape(section)}\s*$(.*?)(?=^##\s|\Z)", proof_text, re.M | re.S)
    if block is None:
        return None
    rows = {}
    for line in block.group(1).splitlines():
        match = ROW.match(line.strip())
        if match:
            rows[norm(match.group(2))] = (match.group(1), match.group(3).strip())
    return rows


def has_evidence(run_dir, relative):
    try:
        path = (run_dir / relative).resolve()
        return path.is_relative_to(run_dir.resolve()) and path.is_file() and path.stat().st_size > 0
    except OSError:
        return False


def verify(proof_text, acceptance, gotchas, run_dir):
    problems = []
    rows = section_rows(proof_text, "Acceptance") or {}
    for item in acceptance:
        row = rows.get(item)
        if row is None:
            problems.append(f"missing acceptance point: {item}")
        elif row[0] != "PASS":
            problems.append(f"acceptance point not passed: {item}")
        elif not has_evidence(run_dir, row[1]):
            problems.append(f"missing acceptance evidence: {item} -> {row[1]}")
    rows = section_rows(proof_text, "What usually breaks") or {}
    for item in gotchas:
        row = rows.get(item)
        if row is None:
            problems.append(f"missing breakage item: {item}")
        elif row[0] == "UNREACHABLE":
            if len(row[1]) < 10:
                problems.append(f"breakage item needs a reason: {item}")
        elif row[0] != "PASS":
            problems.append(f"breakage item not tried: {item}")
        elif not has_evidence(run_dir, row[1]):
            problems.append(f"missing breakage evidence: {item} -> {row[1]}")
    if problems:
        raise ValueError("; ".join(problems))


def main():
    ticket, sha, proof_path = sys.argv[1:4]
    proof = Path(proof_path)
    text = proof.read_text()
    run = RUN.search(text)
    page = PAGE.search(text)
    if run is None or page is None:
        sys.exit("FAIL: proof.md needs Run and Feature map lines before coverage")
    try:
        raw = subprocess.check_output(["hypertask", "--json", "tasks", "get", ticket], text=True, timeout=60)
        task = json.loads(raw)["tasks"][0]
    except (subprocess.SubprocessError, ValueError, KeyError, IndexError) as error:
        sys.exit(f"FAIL: cannot read ticket acceptance points: {error}")
    root = Path(os.environ.get("SHIP_CHECKOUT") or os.getcwd())
    try:
        markdown = subprocess.check_output(
            ["git", "-C", str(root), "show", f"{sha}:{page.group(1)}"], text=True, timeout=60
        )
    except subprocess.SubprocessError as error:
        sys.exit(f"FAIL: cannot read {page.group(1)} at {sha[:9]}: {error}")
    acceptance = acceptance_items(task.get("description"))
    gotchas = gotcha_items(markdown)
    if not acceptance and not gotchas:
        print("coverage skipped: no acceptance points and no Gotchas")
        return
    try:
        verify(text, acceptance, gotchas, proof.parent / run.group(1))
    except ValueError as error:
        sys.exit(f"FAIL: {error}")
    print(f"coverage ok: {len(acceptance)} acceptance points, {len(gotchas)} breakage items")


if __name__ == "__main__":
    main()
