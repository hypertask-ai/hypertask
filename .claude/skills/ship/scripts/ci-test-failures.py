#!/usr/bin/env python3
# Shared ci-tests log parser; ship-check keeps its terse output, alerts request JSON.
import json, re, sys
log = re.sub(r"\x1b\[[0-9;]*m", "", sys.stdin.read())
log = re.sub(r"(?m)^\d{4}-\d\d-\d\dT\S+\s?", "", log)
path = r"tests/[^\s\x27\"():]+\.test\.\w+:\d+(?::\d+)?"
locations = re.findall(r"(?:test at |location:\s*[\x27\"]?(?:[^\n]*?/)?)(" + path + r")", log)
stacks = re.findall(r"(?m)^\s+at [^\n]*?(" + path + r")", log)
names = re.findall(r"(?m)^\s*not ok \d+ - (.+)$|^\s*✖ (.+) \([\d.]+ms\)$", log)
items = locations or stacks or [a or b for a, b in names]
unique = {}
for item in items:
    unique.setdefault(re.sub(r":\d+(?::\d+)?$", "", item), item[:180])

# Playwright smoke jobs print one line per test: `✘  10 [Desktop] › e2e/x.spec.ts:111:7 › name (50.1s)`,
# then a numbered failure block, then a `N failed` summary. A spec path never matches the node rules above.
SPEC = re.compile(r"\[([^\]\n]+)\]\s*›\s*(\S+\.(?:spec|test)\.[A-Za-z]+):(\d+)(?::\d+)?\s*›\s*([^\n─]+)")
HEADER = re.compile(r"(?m)^\s*(?:✘|✗|×)\s*\d*|\s*\d+\)\s")
ERROR = re.compile(r"(?m)^\s*((?:[A-Za-z.]*Error(?: \[.*?\])?:|error:|Test timeout|Timeout \w+|expect\()\s*.+)$")
NO_ERROR = "No error line found; see the run log."


def spec_name(raw):
    return re.sub(r"\s+\(\d+(?:\.\d+)?m?s\)\s*$", "", raw).strip()


def spec_failures(text):
    lines = text.splitlines()
    summary = False
    found = {}
    for index, line in enumerate(lines):
        failed_line = summary or bool(HEADER.match(line))
        match = SPEC.search(line)
        if not match:
            if re.match(r"^\s*\d+ failed\s*$", line):
                summary = True
            elif re.match(r"^\s*\d+ (?:skipped|passed|flaky|did not run)", line):
                summary = False
            continue
        if not failed_line:
            continue
        device, file, _line, raw_name = match.groups()
        name = spec_name(raw_name)
        key = (file, name, device.strip())
        if not name or found.get(key, {}).get("error", NO_ERROR) != NO_ERROR:
            continue
        error = NO_ERROR
        for follow in lines[index + 1:index + 12]:
            hit = ERROR.search(follow)
            if hit:
                error = hit.group(1).strip().strip("\"'")[:500]
                break
            if summary or HEADER.match(follow):
                break
        found[key] = {"file": file, "name": name, "device": device.strip(), "error": error}
    return list(found.values())


specs = spec_failures(log)
if "--json" not in sys.argv:
    terse = list(unique.values())
    terse += [f"{s['file']} {s['name']}" for s in specs]
    print("; ".join(terse[:3]))
else:
    failures = []
    for file in unique:
        if not re.fullmatch(r"tests/[^\s]+\.test\.\w+", file):
            continue
        error = NO_ERROR
        # Node spec reporter prints the first useful error immediately after each `test at`.
        for block in re.split(r"(?m)(?=^test at |^\s*not ok )", log):
            if file not in block:
                continue
            match = re.search(r"(?m)^\s*((?:[\w.]*Error(?: \[.*?\])?:|error:)\s*.+)$", block)
            if match:
                error = match.group(1).strip().strip("\"'")[:500]
                break
        failures.append({"file": file, "error": error})
    print(json.dumps(failures + specs))
