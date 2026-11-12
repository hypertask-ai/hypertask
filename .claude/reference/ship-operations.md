# Shipping operations

Load only the section needed by the current /ship step. House rules override historical flag, dispatch, model and parking policy. Command validation remains in the original scripts; this reference does not replace any control.

## Other repositories

For non-app repositories, configure `SHIP_REPO`, `SHIP_BASE`, and `SHIP_CHECKOUT` before generating gates and repeat them for checks and the Done move. The gate generator persists them. Native CLI uses `hypertask-ai/cli`, base `main`; verify uses `hypertask-ai/verify`, base `app-suite`. Verify releases require a merge-SHA release and an updated nightly checkout. Release-less repos may use `SHIP_DEPLOY=none`; a real release takes precedence. Cloudflare workers additionally use `SHIP_WORKER`; deployment proof requires the merge version active at 100%. See script validation before choosing settings.

## Flag operations

Use `ht-flag` through your session identity. Existing switches require the supported approval path: a clear unedited yes within seven days, matched to the named flag and mode. A thumbs-up, Valentin's own comment, or an HT Product Lead record of his exact chat words may qualify. Re-read comments and reactions before repeating a wait. Ambiguous yes is not approval. Batch approvals must name every switch together.

The reason must link to the exact approval comment. A later human no withdraws approval; edited, conditional, or ambiguous answers do not approve. Everyone review switches require policy approval, another flag-owner agent's independent review, and live evidence; the writer cannot review itself. Reviews are single-use within 24 hours. High-risk flags retain the human-approval path. Run the core inbox cycle as QA 985 before requesting Everyone and immediately afterward. A failure means Owner + QA first, never Off. Never park a ticket in Valentin Review merely to request a flag switch.

For any flagged failure, a flag-owner write/admin agent holds the flag at Owner + QA with `ht-flag set KEY owner-qa --failure "<reason>"`, then repairs. Never switch a flag Off: Off is Valentin's own safety switch. A hold narrows who sees a broken feature, so it needs no approval and applies to every flag, including high-risk and bugfix. The action is audited and refuses no-ops. Other modes retain approval requirements. A held flag stays held until Valentin decides its next mode; never turn a failed flag back on automatically. Only Valentin may open the admin page with his login; runners use approved APIs.


## Exceptions

- **Blocked after two attempts:** a killed local test is not an attempt; push and let CI decide. Otherwise record what failed and why on the ticket, then route it by reason; Agent Blocked is not a general waiting column. Needs a design: UX needed. Valentin's own call: Valentin Review with one Question. Waiting on another ticket or a date: its home column, with a link. Merged and waiting for a live check: QA. Only a broken tool or server stays in Agent Blocked. Keep evidence and a resumable state. Follow the current dispatch limit before choosing more work. `blocker-review` prints every ticket parked over a day with the column it belongs in.
- **Human decision:** use Valentin Review only for a real decision about money, access, security, or irreversible actions. Write the Question exactly in the house-rules tickets skill format (`~/.local/share/house-rules/skills/tickets/SKILL.md`): max 3 plain bullets of context, then Question, My recommendation and Why right under it, then Yes and No, a blank line between each. No outside links or product precedents. Preserve any existing question instead of reposting it.
- **Already fixed:** use `ship-check duplicate` to bind the fixing ticket's merged PR. Record this session's branch, or none. Prove the result live before closing. A partial fix is not a duplicate.
- **No change needed:** use `ship-check nochange` only after a `Resolved without a change:` comment with evidence. No open/bound PR or unmerged ticket branch may remain.
- **Decided against:** quote Valentin's dated decision in the required `Decided against: Valentin, YYYY-MM-DD:` comment, close the PR unmerged, and use `ship-check dropped`. Never claim it deployed.
- **Archived:** read the archive state first. Done means verify the existing live result. Otherwise restore through the product surface before working. Search Normal, Archive, and Deleted before declaring a ticket missing; board moves can change its number.


## Protected parts

When the Agent Kit blocks work, search board 11514 first and +1 the existing ticket with `vcc activity add`; file a new one only if none exists and the board is under its cap (`vcc` refuses otherwise). Never duplicate another active repair. Fix only the blocker through the normal ticket/PR path. Protected parts require Chief Of Staff review and merge: `ship-gates`, the guard part of `ship-check`, `ship-identity`, the `vcc` wrapper, `.claude/skills/unlazy/`, `.claude/hooks/`, `.claude/settings.json`, `CLAUDE.md`, and `AGENTS.md`. Hand the PR over on its ticket; do not self-merge.


## Runner installation

Runner timers, webhooks, pickup, and self-update have their own scripts. Read them only for an installation or dispatch task, not every ticket. New user timers require `user-unit-check` before enablement and one successful first real run afterward.
