export default {
  id: 'signed-in-create-task', area: 'board', title: 'Create a signed-in task',
  description: 'Create and reload a task on the plain QA account\'s private board, then permanently remove it.',
  safe: true, signedIn: true,
  steps: [
    { action: 'goto', arg: '{{boardUrl}}' },
    { action: 'aiWaitFor', arg: 'a kanban board with a To Do column is visible' },
    { action: 'click', arg: '.create-new-task-button' },
    { action: 'aiWaitFor', arg: 'the new task title input is visible' },
    { action: 'aiInput', value: '{{taskTitle}}', arg: 'the title input of the new task form' },
    { action: 'saveTask', arg: 'Save & close in the new task form' },
    { action: 'verifyCreatedTask', arg: 'new task saved on the QA board' },
    { action: 'goto', arg: '{{boardUrl}}' },
    { action: 'aiAssert', arg: 'a task card titled "{{taskTitle}}" is visible' },
  ],
};
