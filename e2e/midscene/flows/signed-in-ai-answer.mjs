export default {
  id: 'signed-in-ai-answer', area: 'ai', title: 'Receive an AI answer',
  description: 'Ask a short arithmetic question in a new QA chat, verify an assistant response rather than the echoed prompt, then delete only that chat.',
  safe: true, signedIn: true,
  steps: [
    { action: 'createChat', arg: 'create an isolated QA chat' },
    { action: 'goto', arg: '{{chatUrl}}' },
    { action: 'aiWaitFor', arg: 'the AI chat message input is visible' },
    // HTPR-7063: Verified fill retries until the full text is in the composer; a cut-off prompt made the assistant ask what was meant.
    { action: 'fillVerified', value: 'What is 17 plus 25? Reply with only the number.', arg: '#ai-chat-tiptap-editor .ProseMirror[contenteditable="true"]' },
    { action: 'click', arg: 'button[aria-label="Send message"]:not([disabled])' },
    { action: 'aiWaitFor', arg: 'an assistant answer containing the number 42 is visible, separate from the user question', timeoutMs: 90_000 },
    { action: 'aiAssert', arg: 'the assistant answered 42 and no error or upgrade request is displayed' },
    { action: 'verifyChatAnswer', arg: 'the isolated QA chat has a persisted assistant answer' },
  ],
};
