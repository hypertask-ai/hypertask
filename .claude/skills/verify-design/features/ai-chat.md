# AI chat

The AI chat in three forms: the full-screen chat page, the sidebar chat and floating chat windows. Design tickets change the composer (mic left of Send, no sparkle), shadows and corners here.

## Sub-features

- `chat-full` the full-screen chat at `/chat`.
- `chat-sidebar` the chat panel beside a board.
- `chat-floating` floating chat windows and their shadow.
- `chat-composer` the message box, mic and Send button.

## How to get to it (user POV)

- Open `https://app.hypertask.ai/chat`.
- Press Ctrl+Shift+O for a new chat.
- Press Ctrl+Shift+E to switch the sidebar chat to full screen and back.

## Driving it with design-check

Preconditions:

- The ticket frame shows the chat state you shoot: an empty composer unless the frame shows messages.

- **Full-screen chat.** Run `design-check run <TICKET> "https://app.hypertask.ai/chat" --frame <frame.png> --themes <brief themes>`. `side-<theme>.png` shows the composer next to the frame.
- **Floating or sidebar chat.** Open it the user's way: `design-check run <TICKET> "https://app.hypertask.ai/project?id=7049&surface=board" --frame <frame.png> --press "Control+Shift+O"`.
- **Composer rules.** The mic sits left of Send. `audit-<theme>.json` has zero sparkle findings.
- **Proof.** Attach the side images and `report.md`.

## Gotchas

- Chat may restore the last open conversation. A frame of an empty chat needs a new chat first.
- Floating windows remember their place. A window off screen makes the shot empty; open a new chat to reset.
