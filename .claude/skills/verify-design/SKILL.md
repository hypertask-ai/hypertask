---
name: verify-design
description: Design QA for Hypertask (app.hypertask.ai). Puts the live screen next to the ticket's approved design frame in Light, AMOLED and Graphite 2, scores each pair, and flags purple, sparkle icons and corners other than 0, 2 or 4px. Use for every design-pass, Figma or visible UI ticket, before QA verdicts and before any flag goes to Everyone.
---

# Verify design

Valentin, 2026-11-04:

> tickets had exact specifications and what was delivered was nothing like what was requested

Judging a design by eye failed 9 of 10 tickets. This skill replaces the eye with one command and a reviewer checklist. It drives production as the QA account, never Valentin's browser, and never builds or runs the app on the VPS.

## Rules

- The approved frame wins over ticket text and over the style guide.
- The builder never passes its own design QA. A different runner marks the checklist.
- Every theme the brief changes needs a frame. No frame for a changed theme: stop and ask on the ticket.
- A theme the brief does not change gets a no-change check against production before the merge.
- Any purple, any sparkle icon, any corner other than 0, 2 or 4px is a FAIL. Round elements are allowed only when a class or data-testid names them avatar or status-dot.
- A FAIL sends the ticket back to Bugs. Never Done, never Everyone.

## Launch

Nothing to launch. The target is production, `https://app.hypertask.ai`, after the Production deployment for the merge succeeded.

1. Get the QA state path: `.claude/skills/verify-qa/scripts/qa-login flags --state`.
2. Make sure the ticket's flag reaches the QA account: Owner + QA or Everyone (`.claude/skills/ship/scripts/ht-flag get <flag-key>`).

The theme is a cookie per browser context, so parallel runs never clobber each other.

## Doctor

Run first, and again whenever a shot looks wrong:

```bash
.claude/skills/verify-design/scripts/design-check doctor
```

It checks the QA state, the QA identity, that the QA board `https://app.hypertask.ai/project?id=7049&surface=board` opens without a redirect, and that the theme cookie switches the page theme. It ends with `doctor ok`. Do not judge a design before it does.

## Drive

One command per ticket and screen:

```bash
.claude/skills/verify-design/scripts/design-check run <TICKET> "<live url>" --frame <frame-name.png> \
  [--themes porcelain,amoled,graphite-2] [--viewport 1920x1032] [--press "<keys>"] [--allow-redirect]
```

- `--frame` is the approved frame image embedded in the ticket. List them with `design-check frames <TICKET> <dir>`; `frames.tsv` gives each name and size.
- Use the frame's own size as `--viewport` so the pair lines up.
- `--themes` lists the themes the brief names. Default is all three: `porcelain` is Light, `amoled` is AMOLED, `graphite-2` is Graphite 2.
- `--press` opens an overlay before the shot, for example the AI chat or the task writer. See the feature map.
- The other subcommands (`frames`, `checklist`, `shoot`, `compare`) run single steps. `design-check --help` shows each.

Pick the screen recipe from [the feature map](features/README.md).

## Evidence

`run` writes everything to `~/.local/state/vcc-evidence/<TICKET>/<YYYY-MM-DD>-design-run-<n>/` and prints that folder last:

- `frames/` with every embedded frame, `frames.tsv`, `figma-links.txt`
- `live-<theme>.png` and `audit-<theme>.json` per theme
- `side-<theme>.png`: design left, live right, labelled
- `report.md`: per-theme score (0 is identical, lower is closer), purple, sparkle and corner counts, then the brief as a numbered checklist

Proof standard:

- The score helps a reviewer look; it never passes a ticket alone. A reviewer reads every side-by-side.
- The reviewer is a different runner. It marks each checklist line PASS or FAIL with the side image it used.
- Attach the side images and `report.md` to one `--kind qa` comment. Link the run folder in the QA proof per [verify-qa](../verify-qa/SKILL.md).
- A redirect or a login page is never evidence. `--allow-redirect` only with the landed URL named in the comment.

## Cleanup

`run` starts and closes its own headless browsers. It creates no tickets, rows or settings. Nothing to tear down. The run folder is the evidence: never delete it. The evidence pruner in verify-qa ages it out.

## Gotchas

- The QA account opening board 15, My Tasks or Inbox lands on its own board 7049 (https://app.hypertask.ai/detail/project-15/8815). Use board 7049 for board-level screens until that is fixed.
- Graphite 2 only appears while `htpr-8054-graphite-2` reaches the QA account.
- A ticket flag at Off hides the change from the QA account. The shot then shows the old design and must FAIL, not pass.
- Frames are 1920x1032 on most design-pass tickets. A different viewport makes the score meaningless.
