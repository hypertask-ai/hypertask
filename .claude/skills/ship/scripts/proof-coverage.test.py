#!/usr/bin/env python3
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import proof_coverage as pc

fails, passes = 0, 0


def check(condition, name):
    global fails, passes
    if condition:
        passes += 1
        print(f"ok   {name}")
    else:
        fails += 1
        print(f"FAIL {name}")


def refused(name, proof, acceptance, gotchas, run):
    try:
        pc.verify(proof, acceptance, gotchas, run)
    except ValueError as error:
        check(name in str(error), f"{name} is named in the refusal")
        return str(error)
    check(False, f"{name} was refused")
    return ""


html_ticket = (
    "<p><strong>Remove the quick add row.</strong></p>"
    "<p><strong>Done means.</strong></p>"
    "<ul><li><p>The row is gone on desktop.</p></li>"
    "<li><p>No new add control replaces it.</p></li>"
    "<li><p>Related: <a href='https://x'>HTPR-6568</a>.</p></li></ul>"
    "<h2>Risk</h2><ul><li><p>A board control breaks.</p></li></ul>"
    "<h2>Done when</h2><ul><li><p>The keyboard sheet lists every key.</p></li></ul>"
)
items = pc.acceptance_items(html_ticket)
check(items == ["The row is gone on desktop", "No new add control replaces it",
                "The keyboard sheet lists every key"], "acceptance points come from both sections")
check("Related: HTPR-6568" not in items, "a related link is not an acceptance point")
check("A board control breaks" not in items, "a risk bullet is not an acceptance point")

markdown = (
    "# Page\n\n## Gotchas\n\n"
    "- Controls nobody asked for showing up on top, like the\n"
    "  \"Quick add\" bar removed in\n  [HTPR-6570](https://x).\n"
    "- A control that fights the board keys.\n\n"
    "### What proof to collect\n\n- A screenshot.\n"
)
gotchas = pc.gotcha_items(markdown)
check(gotchas == ["Controls nobody asked for showing up on top, like the \"Quick add\" bar removed in HTPR-6570",
                  "A control that fights the board keys"], "gotchas join wrapped lines and ignore later headings")

with tempfile.TemporaryDirectory() as temporary:
    folder = Path(temporary)
    run = folder / "2026-11-20-qa-run-1"
    run.mkdir()
    (run / "shot.png").write_bytes(b"png")
    (run / "empty.txt").write_bytes(b"")
    acceptance = ["The row is gone on desktop", "No new add control replaces it"]
    gotchas = ["A control that fights the board keys"]
    good = (
        "## Cases\n- PASS: removal -> shot.png\n\n"
        "## Acceptance\n"
        "- PASS: The row is gone on desktop -> shot.png\n"
        "- PASS: No new add control replaces it -> shot.png\n\n"
        "## What usually breaks\n"
        "- UNREACHABLE: A control that fights the board keys -> no board keys on this page; keyboard sheet checked\n"
    )
    try:
        pc.verify(good, acceptance, gotchas, run)
        check(True, "a complete proof passes")
    except ValueError as error:
        check(False, f"a complete proof passes ({error})")

    refused("No new add control replaces it", good.replace(
        "- PASS: No new add control replaces it -> shot.png\n", ""), acceptance, gotchas, run)
    refused("The row is gone on desktop", good.replace(
        "- PASS: The row is gone on desktop -> shot.png", "- FAIL: The row is gone on desktop -> shot.png"),
        acceptance, gotchas, run)
    refused("The row is gone on desktop", good.replace(
        "desktop -> shot.png", "desktop -> missing.png"), acceptance, gotchas, run)
    refused("The row is gone on desktop", good.replace(
        "desktop -> shot.png", "desktop -> empty.txt"), acceptance, gotchas, run)
    old_style = "## Cases\n- PASS: keys work -> shot.png\n"
    refused("The row is gone on desktop", old_style, acceptance, gotchas, run)
    refused("A control that fights the board keys", good.replace(
        "## What usually breaks", "## Other"), acceptance, gotchas, run)

    chat_proof = (
        "Feature map: .claude/skills/verify-qa/reference/feature-map/ai-chat.md\n"
        "Run: 2026-10-30-qa-run-1\n\n## Cases\n- PASS: all shortcuts work -> shot.png\n"
    )
    try:
        pc.verify(chat_proof, ["Hover shows the key", "Sidebar goes full screen"], [], run)
        check(False, "the old chat shortcuts proof is refused")
    except ValueError as error:
        check("Hover shows the key" in str(error), "the old chat shortcuts proof is refused")

print(f"{passes} passed, {fails} failed")
sys.exit(1 if fails else 0)
