#!/usr/bin/env python3
"""Check a Figma design frame against the app's LIVE code, so a design never invents values.

Usage:
  ds-check.py --repo ~/projects/multiprompt --files src/workspace_switcher.zig --frame frame.json

frame.json comes from the dump snippet in ../SKILL.md ("Check values against live code").
Code is read from the remote default branch after a fetch, never the local checkout.
Exit 1 when any frame radius or colour is not used in the touched files or the theme files.

Apps listed in APP_POLICY have a fixed corner set instead. Live code never widens it:
a round corner already in code is a bug to fix, not precedent. Fully round (circle or pill)
always fails there, and so do round corners in the touched files.
"""
import argparse
import json
import math
import re
import subprocess
import sys

APP_POLICY = {
    "hypertask": {"corners": {0, 2, 4}, "ref": "origin/production"},
}

ROUND = math.inf
THEME_FILES = ["src/themes.zig", "src/app_state.zig", "src/chat_style.zig"]
RADIUS_LINE = re.compile(r"radius|RoundRect|RADIUS|CornerShape|CircleShape", re.I)
RADIUS_NUM = re.compile(r"(?:scale|uiScaled|scaled)\((\d+)\)|RADIUS\s*[:=][^=]*?(\d+)\s*;|radius:\s*i32\s*=\s*(\d+)|RoundedCornerShape\((\d+)\.dp\)|(?:topStart|topEnd|bottomStart|bottomEnd)\s*=\s*(\d+)\.dp")
PILL_HEIGHT = re.compile(r"height\((\d+)\.dp\)[^\n]*CircleShape")
RGB = re.compile(r"RGB\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)")
HEX = re.compile(r"(?:#|0x[fF]{2})([0-9a-fA-F]{6})\b")

TAILWIND_SIZES = {"none": 0, "xs": 2, "sm": 4, "": 4, "md": 6, "lg": 8, "xl": 12,
                  "2xl": 16, "3xl": 24, "4xl": 32, "full": ROUND}
TAILWIND = re.compile(r"(?<![\w-])!?rounded(?:-(?:tl|tr|br|bl|ss|se|es|ee|t|r|b|l|s|e))?"
                      r"(?:-(none|xs|sm|md|lg|xl|2xl|3xl|4xl|full|\[[^\]\s]+\]))?(?![\w-])")
CSS_RADIUS = re.compile(r"border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius\s*:\s*([^;}\]\n]+)", re.I)
JSX_RADIUS = re.compile(r"border(?:Top|Bottom|Start|End)?(?:Left|Right|Start|End)?Radius\s*:\s*([^,}\n]+)")
CSS_KEYWORDS = {"!important", "inherit", "initial", "unset", "revert"}
LENGTH = re.compile(r"^(-?\d*\.?\d+)(px|rem|em|%)?$")


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, check=True).stdout


def live_source(repo, path, ref):
    try:
        return git(repo, "show", f"{ref}:{path}")
    except subprocess.CalledProcessError:
        return ""


def app_name(repo):
    try:
        url = git(repo, "remote", "get-url", "origin").strip()
    except subprocess.CalledProcessError:
        return ""
    return url.rstrip("/").rsplit("/", 1)[-1].removesuffix(".git").lower()


def length_px(token):
    """Pixels for one CSS length; ROUND for fully round; None when it cannot be read."""
    t = token.strip().strip("'\"`").strip()
    if t.startswith("[") and t.endswith("]"):
        t = t[1:-1]
    m = LENGTH.match(t)
    if not m:
        return None
    n, unit = float(m.group(1)), m.group(2) or "px"
    if unit == "%":
        return ROUND if n >= 50 else None
    px = n * 16 if unit in ("rem", "em") else n
    return ROUND if px >= 999 else px


def css_corners(text):
    """Every corner in Tailwind, CSS or JSX style syntax as (line, snippet, px)."""
    out = []
    for no, line in enumerate(text.splitlines(), 1):
        for m in TAILWIND.finditer(line):
            size = m.group(1) or ""
            px = length_px(size) if size.startswith("[") else TAILWIND_SIZES[size]
            out.append((no, m.group(0), px))
        for rx in (CSS_RADIUS, JSX_RADIUS):
            for m in rx.finditer(line):
                value = m.group(1).strip().rstrip(";").strip()
                for part in re.split(r"[\s/]+", value.strip("'\"`")):
                    if part and part.lower() not in CSS_KEYWORDS:
                        out.append((no, m.group(0).strip(), length_px(part)))
    return out


def radii(text):
    found = set()
    for line in text.splitlines():
        if RADIUS_LINE.search(line):
            for m in RADIUS_NUM.finditer(line):
                found.add(int(next(g for g in m.groups() if g)))
            for m in PILL_HEIGHT.finditer(line):
                found.add(int(m.group(1)) // 2)
    found |= {round(px) for _, _, px in css_corners(text) if px is not None and px != ROUND}
    return found


def colours(text):
    found = {"%02x%02x%02x" % tuple(int(x) for x in m.groups()) for m in RGB.finditer(text)}
    found |= {m.group(1).lower() for m in HEX.finditer(text)}
    return found


def near(hex_value, palette, tol):
    r, g, b = (int(hex_value[i:i + 2], 16) for i in (0, 2, 4))
    for p in palette:
        pr, pg, pb = (int(p[i:i + 2], 16) for i in (0, 2, 4))
        if max(abs(r - pr), abs(g - pg), abs(b - pb)) <= tol:
            return p
    return None


def node_radii(node):
    values = node.get("radii") or [node.get("radius")]
    return [r for r in values if r is not None]


def node_is_round(node):
    if node.get("type") == "ELLIPSE":
        return True
    w, h = node.get("w"), node.get("h")
    if not w or not h:
        return False
    return any(r > 0 and r >= min(w, h) / 2 for r in node_radii(node))


def policy_frame_problems(nodes, allowed):
    bad = []
    for n in nodes:
        if node_is_round(n):
            bad.append(f"fully round shape on {n['path']}: this app has no circles or pills; use 4px")
            continue
        for r in node_radii(n):
            if round(r) not in allowed:
                bad.append(f"radius {r} on {n['path']} is not allowed (only {sorted(allowed)}px)")
    return bad


def policy_code_problems(path, text, allowed):
    bad = []
    for no, snippet, px in css_corners(text):
        if px == ROUND:
            bad.append(f"live code bug {path}:{no} `{snippet}` is fully round; never copy it, use 4px")
        elif px is None:
            bad.append(f"live code {path}:{no} `{snippet}` has an unreadable corner; use 2 or 4px")
        elif round(px) not in allowed:
            bad.append(f"live code bug {path}:{no} `{snippet}` is {px:g}px; only {sorted(allowed)}px")
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--files", nargs="+", required=True, help="source files the design touches")
    ap.add_argument("--frame", required=True, help="JSON dump of the Figma frame")
    ap.add_argument("--ignore", nargs="*", default=[], help="node name substrings to skip, e.g. Today")
    ap.add_argument("--tol", type=int, default=3)
    ap.add_argument("--app", help="corner policy key; default: origin repo name")
    a = ap.parse_args()

    policy = APP_POLICY.get(a.app or app_name(a.repo))
    git(a.repo, "fetch", "-q", "origin")
    ref = policy["ref"] if policy else git(a.repo, "rev-parse", "--abbrev-ref", "origin/HEAD").strip()
    stamp = git(a.repo, "log", "-1", "--format=%h %cd", "--date=short", ref).strip()

    sources = {f: live_source(a.repo, f, ref) for f in a.files}
    touched = "".join(sources.values())
    nodes = [n for n in json.load(open(a.frame)) if not any(s in n.get("path", "") for s in a.ignore)]
    bad = []
    if policy:
        code_radii = set(policy["corners"])
        bad += policy_frame_problems(nodes, code_radii)
        for path, text in sources.items():
            bad += policy_code_problems(path, text, code_radii)
    else:
        theme = "".join(live_source(a.repo, f, ref) for f in THEME_FILES)
        # Corners are per component, so only the touched files count; colours are app-wide tokens.
        code_radii = radii(touched) | radii(theme) | {0}
        for n in nodes:
            for r in node_radii(n):
                if round(r) not in code_radii:
                    bad.append(f"radius {r} on {n['path']} is not in live code (live: {sorted(code_radii)})")

    ext = a.files[0].rsplit(".", 1)[-1]
    app_src = git(a.repo, "grep", "-h", "-E", r"RGB\(|#[0-9a-fA-F]{6}|0x[fF]{2}[0-9a-fA-F]{6}", ref, "--", f"*.{ext}")
    palette = colours(app_src)
    for n in nodes:
        for f in n.get("fills", []):
            if not near(f.lower(), palette, a.tol):
                bad.append(f"colour #{f} on {n['path']} is not in live code")

    print(f"live code: {ref} {stamp}; files: {', '.join(a.files)}")
    print(f"checked {len(nodes)} nodes; radii allowed: {sorted(code_radii)}")
    if bad:
        print(f"FAIL: {len(bad)} invented, changed or banned values. Each needs a named reason and Valentin's yes, or must match code.")
        for line in sorted(set(bad)):
            print("  " + line)
        sys.exit(1)
    print("PASS: every radius and colour in the frame exists in live code.")


if __name__ == "__main__":
    main()
