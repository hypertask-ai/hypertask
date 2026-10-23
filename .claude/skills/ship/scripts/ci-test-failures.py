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
if "--json" not in sys.argv:
    print("; ".join(list(unique.values())[:3]))
else:
    failures = []
    for file in unique:
        if not re.fullmatch(r"tests/[^\s]+\.test\.\w+", file):
            continue
        error = "No error line found; see the run log."
        # Node spec reporter prints the first useful error immediately after each `test at`.
        for block in re.split(r"(?m)(?=^test at |^\s*not ok )", log):
            if file not in block:
                continue
            match = re.search(r"(?m)^\s*((?:[\w.]*Error(?: \[.*?\])?:|error:)\s*.+)$", block)
            if match:
                error = match[1].strip().strip("\"\x27")[:500]
                break
        failures.append({"file": file, "error": error})
    print(json.dumps(failures))
