export default {
  id: 'task-detail-demo',
  area: 'board',
  title: 'Task detail panel opens',
  description: 'Opens the demo board, taps the first task card, and checks a detail panel appears.',
  safe: true,
  steps: [
    { action: 'goto', arg: 'https://app.hypertask.ai/demo' },
    {
      action: 'aiWaitFor',
      arg: 'a kanban board with at least one column and one task card is visible',
      timeoutMs: 30_000,
    },
    { action: 'aiTap', arg: 'the first visible task card on the board' },
    {
      action: 'aiAssert',
      arg: 'a task detail panel is open on the page showing task fields like assignees, due date, or project',
    },
  ],
};
