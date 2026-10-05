export default {
  id: 'task-create-demo',
  area: 'board',
  title: 'Create a task on the demo board',
  description: 'Opens the demo board, creates a task through the UI, and checks the new card appears. The demo board is a disposable guest board so this write is safe.',
  safe: true,
  steps: [
    { action: 'goto', arg: 'https://app.hypertask.ai/demo' },
    {
      action: 'aiWaitFor',
      arg: 'a kanban board with at least one column and one task card is visible',
      timeoutMs: 30_000,
    },
    { action: 'click', arg: '.create-new-task-button' },
    { action: 'input', value: 'midscene flow check', arg: '#newTask [placeholder="Title"]' },
    { action: 'saveTask', arg: 'Create task', value: 'midscene flow check' },
    { action: 'aiWaitFor', arg: 'a task card with the title "midscene flow check" is visible on the board' },
    { action: 'goto', arg: 'https://app.hypertask.ai/demo' },
    {
      action: 'aiAssert',
      arg: 'a task card with the title "midscene flow check" is visible on the board',
    },
  ],
};
