// HTPR-5720: port of the HTPR-5715 smoke flow into the declarative flow format.
export default {
  id: 'board-demo',
  area: 'board',
  title: 'Demo board renders',
  description: 'Opens the anonymous demo board and checks the kanban columns load with cards.',
  safe: true,
  steps: [
    { action: 'goto', arg: 'https://app.hypertask.ai/demo' },
    {
      action: 'aiWaitFor',
      arg: 'a kanban board with at least one column and one task card is visible',
      timeoutMs: 30_000,
    },
    { action: 'aiAssert', arg: 'a kanban board with task cards is visible on the page' },
    {
      action: 'aiQuery',
      arg: 'string[], the visible column/section names on the kanban board',
      expect: { contains: ['To Do', 'In Progress', 'Done'] },
    },
  ],
};
