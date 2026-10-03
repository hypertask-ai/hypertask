---
name: drain-board
description: Work through every open ticket on one Hypertask board until each is settled (Done, or in Valentin Review with a Question), proven by an unlazy ledger with one gate per ticket. Valentin types /drain-board <board id or link>; a loop may run it later. Use when he says "drain this board" or "go through all tickets".
---

# Drain board

Valentin, 2026-10-03: "makes the agent go through all tickets in the board using /unlazy ledger". He types `/drain-board <project id or board link>` (no id: ask which board).

**Settled** means one of: Done (fixed with proof, or closed with a reason), archived, or Valentin Review with one `Question:` comment for him. A ticket that cannot be read never counts as settled.

## Steps

1. **Ledger.** Load `unlazy`. From `~/projects/hypertask`, run `~/.agents/skills/drain-board/scripts/drain-board gates <id>`. It adds one gate per open ticket to this session's ledger (`.unlazy/s-<session>/gates/drain-<id>.md`); `check <TICKET>` prints `settled` once the ticket is Done or in Valentin Review. Rerun `gates` after each pass: new tickets get gates, existing ones are kept.
2. **Hands off.** Do not touch, and mark `ABANDON: drain-<id>.<TICKET> <reason>`:
   - assigned to Abdul;
   - "Claimed." and In Progress by another session or runner (say which);
   - assigned to or moved by Valentin himself and left there.
3. **Triage each remaining ticket, oldest first.** Read it with its comments (`hypertask tasks get`). Pick one:
   - **Close**: done already, duplicate (link the other ticket), or no longer relevant. One `vcc` comment with the reason in plain words, then move to Done.
   - **Ask**: needs his decision (money, login and access, security, can't be undone, product direction, or something only he has). One `Question:` comment that @mentions him, yes or no, then move to Valentin Review.
   - **Fix**: everything else. Work it with `/ship <TICKET>`, one ticket at a time, or hand self-contained pieces to Codex helpers (hax, each with its own ledger). Reverify a helper's gates yourself.
4. **Board writes** only through `vcc`, ending with the `Next:` line and this session's resume command. Read the ticket back after each move. Lists paginate: always `--limit 500`.
5. **Finish.** `node ~/.agents/skills/unlazy/scripts/gate-check.mjs <drain file>` shows every gate met or abandoned with a reason. Tell Valentin in chat: how many closed, fixed, asked, left alone (with why), plus the board link opened in his pane.

## Not this skill

Writing rules or skills for runners, renaming boards, or acting on runners and identities: those need his go first.
