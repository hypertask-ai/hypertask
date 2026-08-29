// HTPR-5720: flow registry. Each flow module's default export is data
// ({ id, area, title, description, safe, steps }), not code, so the
// steps can also be rendered on the qa-flows docs page.
import boardDemo from './board-demo.mjs';
import taskDetailDemo from './task-detail-demo.mjs';
import taskCreateDemo from './task-create-demo.mjs';
import landing from './landing.mjs';
import loginScreen from './login-screen.mjs';

export const flows = [boardDemo, taskDetailDemo, taskCreateDemo, landing, loginScreen];

export function getFlow(id) {
  return flows.find((f) => f.id === id);
}
