export default {
  id: 'signed-in-reminder', area: 'reminders', title: 'Schedule a reminder',
  description: 'Set a reminder through the QA task UI, verify the saved reminder, then cancel it by permanently deleting the fixture task.',
  safe: true, signedIn: true,
  steps: [
    { action: 'createFixtureTask', arg: 'create a disposable QA task' },
    { action: 'goto', arg: '{{taskUrl}}' },
    { action: 'aiWaitFor', arg: 'the task detail is visible' },
    { action: 'aiKeyboardPress', arg: 'h' },
    { action: 'aiWaitFor', arg: 'the Remind me dialog with time options is visible' },
    { action: 'saveReminder', arg: 'Tomorrow' },
    { action: 'verifyReminder', arg: 'a future reminder is saved for this QA task' },
    { action: 'goto', arg: '{{taskUrl}}' },
    { action: 'verifyReminder', arg: 'the future reminder is still saved after reloading the task' },
  ],
};
