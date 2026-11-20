---
name: artifact-wireframe
description: "Hypertask wireframe/mockup/redesign by live conversation: one clickable claude.ai Artifact HTML; update same link within minutes per change."
---

# artifact-wireframe

Valentin, 2026-10-19: "SAVE THSI PROICESS AS THJE NEW WIREFRAMING PROCESS!!!!!!!!!!!! this was very fast and very good" and "can we put it in a skill? wireframing with claude artificats". First used on HTPR-7328 (Material 3 theme): 15 versions in about two hours, approved.

## Why it is fast

- **One file, one link.** A single self-contained HTML file; every change republishes to the SAME artifact URL, so he only refreshes.
- **He talks, the session edits.** No options pages, tables, reference shots, ledgers or tickets per tweak. One view unless he asks; more views are clickable inside the same file.
- **Screenshots in, screenshots out.** He sends screencast2 links of the live app and of apps he likes (Gemini, ChatGPT); the session looks at each one, edits, and checks its own headless screenshots before republishing.
- **Small scripted edits.** Edit with the Edit tool or one small Python replace script per message, never a rewrite.

## Steps

1. **Start from the live app.** Before drawing, read the real labels, icons, positions and shortcuts from production code (`git show origin/production:...`: HTC command files for shortcuts, rail and tooltip components). Write them down once.
2. **Build the first view** as `~/<name>.html`: tokens on `:root` with a dark-mode override, real board data, `data-tip` + `data-key` on every control so hover tooltips show the real shortcut ChatGPT-style (label plus one key chip).
3. **Publish once** with the Artifact tool (load `artifact-design` first), then post the link on the ticket once.
4. **Per message from him:**
   - Run `mp-eta` first; download every screenshot link into the scratchpad and look at it.
   - Edit the file.
   - Run the headless Playwright click-through (light and dark, 1440x900; scripts use `createRequire("/home/valentin/projects/hypertask/package.json")` to load playwright). Require 0 JS errors and look at the PNGs.
   - Republish with `url` set to the same artifact.
   - Reply in one line: what changed and the link.
5. **Approval.** Build stays on hold until he says it is approved. Then record his exact words on the ticket and build behind the ticket's flag.

## Rules that never bend

- **Dress the real app only.** Never invent, renumber or move a shortcut, icon, label or button (Valentin, 2026-10-19: "you changed keyboard shortcuts and icons around this you can't do. you need to leave the app as is and just dress it").
- Tooltips exist to teach shortcuts; every tooltip on a control with a shortcut shows it.
- Keep live layout rules he cares about (task view centred, live widths, resizable AI chat).
- Runners never open his browser; the link goes in chat or on the ticket.
- Never put secrets, tokens or internal infra details in the artifact.
