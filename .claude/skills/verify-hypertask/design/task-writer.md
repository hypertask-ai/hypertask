# Ctrl+J task writer

The new-task composer opened with Ctrl+J: the note box, the mic, the Create button and the key footer.

## Sub-features

- `writer-open` Ctrl+J opens the composer over any page.
- `writer-composer` mic left of Create, model picker.
- `writer-footer` the key footer naming Ctrl+Enter.

## How to get to it (user POV)

- Press Ctrl+J on a board or any app page.

## Driving it with design-check

Preconditions:

- Focus is on the page, not in a text field, so Ctrl+J reaches the app.

- **Open and shoot.** Run `design-check run <TICKET> "https://app.hypertask.ai/project?id=7049&surface=board" --frame <frame.png> --press "Control+j"`. `side-<theme>.png` shows the composer next to the frame.
- **Footer.** The footer names Ctrl+Enter, matching the frame text.
- **Proof.** Attach the side images and `report.md`.

## Gotchas

- Ctrl+J inside a text field may be taken by the browser. The run presses it with the page focused.
- The composer keeps a draft. A draft in the box changes the shot; clear it through the product first.
