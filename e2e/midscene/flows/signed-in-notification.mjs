export default {
  id: 'signed-in-notification', area: 'notifications', title: 'Receive and open a notification',
  description: 'Move a disposable QA task to the account\'s inbox using the normal product action and open its new notification.',
  safe: true, signedIn: true,
  steps: [
    { action: 'createFixtureTask', arg: 'create a disposable QA task' },
    { action: 'moveToInbox', arg: 'trigger the QA task notification' },
    { action: 'goto', arg: 'https://app.hypertask.ai/inbox' },
    { action: 'aiWaitFor', arg: 'an inbox notification for "{{taskTitle}}" is visible' },
    { action: 'aiTap', arg: 'the inbox item titled "{{taskTitle}}"' },
    { action: 'aiWaitFor', arg: 'the task detail is open with title "{{taskTitle}}"' },
    { action: 'aiAssert', arg: 'the task detail is open with title "{{taskTitle}}"' },
  ],
};
