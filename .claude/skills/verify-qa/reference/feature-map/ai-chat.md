# AI chat

## How a customer reaches it

The AI chat panel on a board or task (native chat, `src/app/api/ai/`, flag
`NEXT_PUBLIC_AI_CHAT_NATIVE`), and the mobile Agent Chat surface.

## How to drive it

`agent-browser`, headless, `?realtime=on`. Send a message, wait for a reply,
and check which model actually answered if the ticket names one (the model
picker sends a stable `modelOptionId`; see
`src/lib/aiModelOptions.ts` for the current option list).

Ctrl+J new ticket ([HTPR-7317](https://app.hypertask.ai/detail/project-15/7317)):
press Ctrl+J on a board, type a note, create. The ticket opens with the
sidebar intro "I created X from your note. Want me to refine it?" and, under
"Questions and ideas for this ticket", 2 to 4 chips from
`POST /api/ai/task-questions` with `kind: "new-ticket"`
(`[data-compose-question]`). Wait for the chips (about 10 s), click one and
check it is sent and answered in the same chat.

## What usually breaks

- Provider/gateway slug drift breaking a specific model entirely: Grok chat
  moved between the `xai` and `spacexai` gateway slugs three times in one
  week ([HTPR-6349](https://app.hypertask.ai/detail/project-15/6349), [HTPR-6414](https://app.hypertask.ai/detail/project-15/6414), [HTPR-6415](https://app.hypertask.ai/detail/project-15/6415)), then Grok was pulled from
  chat until needed ([HTPR-6349](https://app.hypertask.ai/detail/project-15/6349) again).
- Token usage blowing up ([HTPR-6507](https://app.hypertask.ai/detail/project-15/6507), "reduce AI chat token usage").
- Chat replies not attaching to the right message after a webhook round-trip
  ([HTPR-6553](https://app.hypertask.ai/detail/project-15/6553), two rounds).
- Failed webhook chats not falling back to polling ([HTPR-6566](https://app.hypertask.ai/detail/project-15/6566), reverted
  once, watch for a recurrence).
- Mobile Agent Chat chrome showing on the wrong path, or the wrong composer
  rendering ([HTPR-6476](https://app.hypertask.ai/detail/project-15/6476), two rounds).
- Ctrl+J chips vanishing once the intro reloads from the server under a new
  id ([HTPR-7317](https://app.hypertask.ai/detail/project-15/7317)): wait a
  few seconds after they appear and check they are still there.

## What proof to collect

Screenshot the sent message and the received reply together, with the model
name visible if the UI shows it. If the ticket is about a specific
model/provider, don't accept a reply from a silently-substituted fallback
model as a pass.

## Cleanup

Delete the test conversation/thread if the account's chat history is
customer-visible; otherwise leave it, AI chat threads aren't board data.
