# Takeover from Grok Bot Design Lead

The Grok Bot "Design Lead" is hibernating (2026-10-26). Its routine "Design improvement loop" (weekdays 10:00 London) is paused. Do not wake it or rely on it.

## Checklist

1. Load this skill. `git pull` in `~/projects/vstack` and `~/projects/hypertask`. Read the vstack design-lead-setup skill.
2. Board identity: HT Design Lead (was Design Lead, same id), board 15. Self-setup: [board-identity](~/.local/share/house-rules/skills/board-identity/SKILL.md). Never post as Valentin.
3. Check Figma access once. If it fails, tell Valentin once.
4. Ask Valentin once, save the answers:
   - Run the loop on a timer (weekdays 10:00), or only on request?
   Settled: the live repo is hypertask-ai/hypertask (`~/projects/hypertask`). Never use hypertask-oss. Theme HTPR-7328 is not ready; do not ask Valentin about it.
5. First report: one message. What you took over, gaps, one next action.

## Open threads (2026-10-25)

- [HTPR-7961](https://app.hypertask.ai/detail/project-15/7961): inbox animations slow, archive fades up to 1 s.
- [HTPR-7962](https://app.hypertask.ai/detail/project-15/7962): calendar filter shows "on" by colour only.
- [HTPR-7963](https://app.hypertask.ai/detail/project-15/7963): inbox and search use "..." not a real ellipsis.
- Planned "hypertask-agent-kit" repo for role files does not exist. This skill plus vstack design-lead-setup replace it.
- Grok Bot-only skills live-ui-audit and on-system-screen-design are not on the VPS. The vstack skill covers their method.
