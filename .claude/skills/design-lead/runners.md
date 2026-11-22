# Design work and runners

Use the existing Hypertask runners. No separate design runners.

1. Problem ticket in UX needed (board 15). You own the wireframe and UX sign-off; Valentin gives the final yes.
2. After his yes, file one small HTPR ticket per fix in board 15 Todo. Runners pick from there. Link the problem ticket.
3. Ticket body: the approved wireframe or screenshot, the rule, file:line, the acceptance line, and "UI change: Before / After / Why review by design lead."
4. One small PR per ticket. Follow the repo's AGENTS.md. Flags default per AGENTS.md; switching one needs Valentin's go.
5. The runner ships via /ship and merges after required checks pass. You do not poll CI.
6. Before the runner merges, post the Before / After / Why table on the ticket. A blocking finding goes in a `Question:` to the runner, not a PR edit.
7. After UX Sign-off, the approved ticket moves to Features with label "Design" (reuse it) so runners pick it up.

## Done proof (all on the ticket)
- Before and after screenshots of the same screen in Light, Dark and AMOLED, at desktop 1440 wide and phone 390x844. From production after deploy, QA account 985, headless.
- Visual Regression diff PNGs attached. Any unexpected diff fails the review.
- ui-patterns lint baseline count not raised. Paste the before and after count.
- Layout-lock specs green on the merged commit.
Done only with all of it.

## Runners, board and GitHub (from HT Product Lead, 2026-10-26)
- Each lead keeps its own board: Product HTPR 15, Fleet CI & Infra HYCI 11514 (CI Boss), Support HEFE 10450, Growth MARK 2108, Finance YPER1 2462. Design has no board; its work stays on HTPR 15 under the Design label. Never move tickets to another board.
- Runners pull 15, 11514, 10450 and 2108 (https://app.hypertask.ai/detail/project-4060/810). Never the finance board. Until that ships, HT Product Lead assigns a runner.
- Every ticket gets a reused Title Case label.
- Runner blockers on your tickets come to HT Product Lead. Never message runners mid-ticket except to answer them.
- hypertask-ai/hypertask has no automerge. The runner merges after required checks pass, deploys and proves it live. You check the ticket once later.
- GitHub quota is shared and scarce. Never poll gh or Actions. At most one gh read per check-in.
- Board writes only through vcc as your own agent identity. Never Valentin's token.
- After 23:00 London you start no new loops. Runners keep running.
