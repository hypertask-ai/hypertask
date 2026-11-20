---
name: figma-design
description: How design agents use Figma for Valentin's apps. Connect through the claude.ai Figma connector, work in Yeo UX for our apps or the client's own Figma team, rebuild real captures, propose by cloning, read and keep each app's design system page (the living style guide) current, use impeccable to check and refine, and hand frames plus keyframes to tickets. Use for any Figma mockup, wireframe, icon, design system or design hand-off.
---

# Figma for design agents

Learned by SF Design Lead on Multiprompt, 2026-10-26. Valentin approved this way of working.

## Connect
- Use the claude.ai Figma connector. Load tools with ToolSearch `select:mcp__claude_ai_Figma__use_figma,...`.
- If the tools are missing, restart the session once so claude.ai connectors load. Do not use mcp-remote (403) or a personal access token (401).
- Before the first `use_figma`, read `skill://figma/figma-use/SKILL.md` (ReadMcpResourceTool, server "claude.ai Figma"). Pass `skillNames: "resource:figma-use"` on every call.
- For our apps, create files in **Yeo UX** (paid, planKey `team::653929828954513812`).
- For client work, use the client's own Figma team when provided. Keep client files separate from other clients.
- Never use Valentin Yeo's free team: it allows only one variable mode.
- Call `create_session` once per file and reuse the session id.
- Keep a ledger file of page and node ids next to your notes, so later calls never search blind.

## Structure each app file
- Pages: Reference captures, Foundations, Components, one page per platform (Desktop, Mobile), App icon, and a **design system page**.
- Design system page: colours as Figma variables (each names its code constant), type scale, spacing and corners, real components with properties and variants, and the rules in one paragraph. Runners build only from it.

## Before any screen (gate)
Valentin, 2026-11-05, after a new Multiprompt screen ignored its style guide:
> the Figma style guide for each app should be a living system, not a dead system

1. Open the app's design system page first. Read its variables (`get_variable_defs`) and components. Put the page link in your ledger.
2. Build only from those variables and components. Never invent a colour, font, size, corner, shadow or component.
3. Something missing? Name it in the people comment as a new piece. Wait for his yes, unless his own ticket asked for it.
4. Cite the design system page link in the agent-lane comment for every proposal.

## Work
1. **Capture first.** Rebuild the current screen from his screenshot (screencast2 link) and trace every value to code. Real app colours can differ from the code theme; sample the capture.
2. **Propose by cloning** the capture frame. Name it `... / PROPOSAL <what>`. Subtract before adding: "Everything needs to earn its place."
3. **Show options.** Give two to six variants side by side, plus your pick with a one-line reason.
4. **Screenshot every change** with `get_screenshot` and look at it before you show him. Fix clipping, overlap and colour emoji yourself.
5. **Keyframe.** Download the screenshots and stitch them into one PNG (Python PIL) for the ticket.

## Check values against live code (gate, before any post)
Valentin, 2026-11-05:
> you have to design something that uses the design system and not degrade it or regress it

Failure it prevents: IGSH-1687 dropdown corners set to 4px and 2px. The source was a stale local checkout plus a Hypertask-only corner rule. Live Multiprompt code used 15, 17 and 10.
1. Read values from the remote default branch after `git fetch`, never a local checkout.
2. Keep every corner, colour and size the code already uses. A changed or new value needs a named reason and his yes.
3. Dump the proposal frame with `use_figma` (replace FRAME_ID), save the result as `frame.json`:
```js
const root = await figma.getNodeByIdAsync('FRAME_ID');
const hex = c => [c.r,c.g,c.b].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');
const out = [];
root.findAll(() => true).forEach(n => {
  let a = n, p = []; while (a && a.id !== root.id) { p.unshift(a.name); a = a.parent; }
  const r = ('cornerRadius' in n && typeof n.cornerRadius === 'number' && n.cornerRadius > 0) ? n.cornerRadius : null;
  const radii = ('topLeftRadius' in n && typeof n.cornerRadius !== 'number') ? [n.topLeftRadius, n.topRightRadius, n.bottomRightRadius, n.bottomLeftRadius] : null;
  const fills = (n.type !== 'TEXT' && Array.isArray(n.fills)) ? n.fills.filter(f => f.type === 'SOLID' && f.visible !== false && (f.opacity ?? 1) > 0).map(f => hex(f.color)) : [];
  if (r !== null || radii || fills.length || n.type === 'ELLIPSE') out.push({ path: p.join('/') + ' [' + n.id + ']', type: n.type, w: n.width, h: n.height, radius: r, radii, fills });
});
return out;
```
4. Run `scripts/ds-check.py --repo <app repo> --files <source files the design touches> --frame frame.json`. Use `--ignore Today` for "today" columns.
5. Post only on PASS. Put the PASS line in the agent-lane comment. On FAIL, fix the frame, or name each new value in the people comment and wait for his yes.
6. Hypertask: no circles or pills, ever. Corners are 0, 2 or 4px. Copying a round element from live code is not allowed; use 4px. ds-check fails it, and flags round corners in the touched files as bugs.

## Show Valentin
- He is often on his phone. Send the image with SendUserFile, and give the Figma link `https://www.figma.com/design/<fileKey>?node-id=<a-b>`. A link alone gets missed.
- If he is at the desktop, open the frame with `zsb navigate`.

## Hand off
- Post one ticket comment: Figma frame links, exact values (hex, dp or px, radius), what stays the same, and the keyframe attached with `--attach`.
- Record his yes (chat or ticket) on the build ticket in his own words, with the frame link. Builders ship it to the flag. They never ask him again or block on design approval.
- Split approved work into build tickets, one per repo, under a parent ticket, with the app label.
- Superseded frames: delete them, so runners never build the wrong one.

## Keep the style guide alive
- Any approved style change updates the design system page the same turn: variable, component, variant or rules paragraph.
- A builder who ships a new value or component also adds it there, in the PR's turn.
- Remove what the app no longer uses. The page shows what live code uses today.
- Note the change in the agent lane with the page link. The next run builds from the new page.

## Impeccable (allowed and recommended)
The `impeccable` skill set sharpens work. The style guide stays the brief: "The brief wins", "Refinement preserves".
- Check: `critique` and `audit` on the live screen or your proposal. Fix what they find.
- Refine inside the style guide: `polish`, `distill`, `clarify`, `harden`, `adapt`, `layout`, `typeset`, `onboard`.
- Style guide sync: `document` or `extract` reads live code into DESIGN.md. Mirror any gap into the design system page.
- Style-changing commands only when his ticket asks: `bolder`, `overdrive`, `colorize`, `delight`, a new visual world or redesign.
- Results still land as Figma frames and app code. They pass ds-check like any other proposal.
- Missing for your harness? Install from its official repo https://github.com/pbakaus/impeccable. Never hand-copy it.

## Gotchas
- `resize()` on an auto-layout frame fixes both axes. Set `primaryAxisSizingMode` or `counterAxisSizingMode` back to `AUTO` afterwards, or content overlaps.
- A frame with `clipsContent` hides children you position by hand. Turn it off on message columns.
- Some symbols (⏸ ⏰ ⚙ 🔒) render as colour emoji. Use plain glyphs.
- Short bubble text: set `textAutoResize` to `WIDTH_AND_HEIGHT`, then cap at the max width, so bubbles hug their text.
- The secrets-guard hook can block heredocs that write JSON or Python. Use the Write tool instead.
