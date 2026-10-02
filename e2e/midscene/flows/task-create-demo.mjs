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
    { action: 'aiWaitFor', arg: 'the new task title input is visible' },
    { action: 'click', arg: '#createTaskModal [id^="popoverId-"] .lucide-x', optional: true },
    { action: 'input', value: 'midscene flow check', arg: '#title-input-modal' },
    { action: 'saveTask', arg: 'Save & close in the new task form' },
    { action: 'aiWaitFor', arg: 'a task card with the title "midscene flow check" is visible on the board' },
    {
      action: 'aiAssert',
      arg: 'a task card with the title "midscene flow check" is visible on the board',
    },
  ],
};
