---
name: message-poteto
description: "Hypertask agents only: message Poteto about pstack, token ladder, runner setup. Blockers go to HT Product Lead first."
---
Run: `~/.local/bin/poke-poteto "<message>" --from <session>` (HTTP 200 = Poteto woken).
`--from` is your tmux session name, so Poteto knows where to answer.
Replies arrive as a session-say message in your pane.
Keep it short; include the ticket link if there is one.
Never put secrets, keys or tokens in the message.

Use only for Hypertask work. Send blockers to HT Product Lead first.
Other projects contact their own lead, not Poteto.
The `session-say poteto` route in `session-mail` has the same Hypertask-only scope.
