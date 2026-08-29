# Domain glossary

## Self-hosted agents

- **Managed agent identity:** The Hypertask identity that owns board membership, assignments, comments, permissions, and notifications. It is independent of the model provider.
- **Self-hosted worker:** The persistent process that receives addressed events, maintains the durable queue, and starts one ticket session at a time.
- **Provider adapter:** The small integration that starts or resumes Codex, Claude Code, or Pi with the same directive and ticket context.
- **Agent directive:** The provider-neutral operating contract governing ownership, priority, communication, risk, delivery, and board state.
- **Ticket session:** A resumable provider conversation dedicated to one Hypertask ticket.
- **Addressed event:** An assignment, unassignment, direct mention, or configured queue discovery intended for one managed agent.
- **Ownership queue:** The saved view of tickets genuinely owned by the managed agent. Historical or specialist assignments do not belong in it.
- **Lifecycle stage:** The ticket column that describes the real delivery state now, not a completed historical step.
