export default {
  id: 'signed-in-ai-answer', area: 'ai', title: 'Receive an AI answer',
  description: 'Ask a short arithmetic question in a new QA chat, verify an assistant response rather than the echoed prompt, then delete only that chat.',
  safe: true, signedIn: true,
  steps: [
    { action: 'createChat', arg: 'create an isolated QA chat' },
    { action: 'goto', arg: '{{chatUrl}}' },
    { action: 'aiWaitFor', arg: 'the AI chat message input is visible' },
    { action: 'aiInput', value: 'What is 17 plus 25? Reply with only the number.', arg: 'the AI chat message input at the bottom' },
    { action: 'click', arg: 'button[aria-label="Send message"]:not([disabled])' },
    { action: 'aiWaitFor', arg: 'an assistant answer containing the number 42 is visible, separate from the user question', timeoutMs: 90_000 },
    { action: 'aiAssert', arg: 'the assistant answered 42 and no error or upgrade request is displayed' },
    { action: 'verifyChatAnswer', arg: 'the isolated QA chat has a persisted assistant answer' },
  ],
};
