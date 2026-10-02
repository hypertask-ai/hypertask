// Flow exports remain declarative so the QA dashboard can render their steps.
import boardDemo from './board-demo.mjs';
import taskDetailDemo from './task-detail-demo.mjs';
import taskCreateDemo from './task-create-demo.mjs';
import createTask from './signed-in-create-task.mjs';
import fileUpload from './signed-in-file-upload.mjs';
import notification from './signed-in-notification.mjs';
import reminder from './signed-in-reminder.mjs';
import aiAnswer from './signed-in-ai-answer.mjs';

export const flows = [boardDemo, taskDetailDemo, taskCreateDemo, createTask, fileUpload, notification, reminder, aiAnswer];

export function getFlow(id) {
  return flows.find((f) => f.id === id);
}
