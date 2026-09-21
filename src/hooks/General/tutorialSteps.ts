import { LEARN_TUTORIAL_DISMISS_TASK_MODAL_EVENT, type LearnTutorialBoardPosition, type LearnTutorialDismissibleSurface, type LearnTutorialInboxTarget } from "@/lib/tutorial/learnTutorialState";

export const dispatchTutorialEscape = (target: EventTarget) => {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    code: "Escape",
    key: "Escape",
  });
  Object.defineProperty(event, "keyCode", { value: 27 });
  target.dispatchEvent(event);
};

export const dismissTutorialTaskModal = (surface: LearnTutorialDismissibleSurface) =>
  window.dispatchEvent(
    new CustomEvent(LEARN_TUTORIAL_DISMISS_TASK_MODAL_EVENT, {
      detail: { surface },
    }),
  );

export const getRenderedBoardPosition = (
  taskId: number,
): LearnTutorialBoardPosition | null => {
  const task = document.getElementById(`task-${taskId}`);
  const section = task?.closest<HTMLElement>(
    "[id^='droppable-section-container-']",
  );
  const taskList = task?.closest<HTMLElement>("[id^='tasks-list-']");
  if (!task || !section || !taskList) return null;

  const sectionId = Number(
    section.id.slice("droppable-section-container-".length),
  );
  const index = Array.from(taskList.children).indexOf(task);
  return Number.isSafeInteger(sectionId) && sectionId > 0 && index >= 0
    ? { sectionId, index }
    : null;
};

export const getRenderedTutorialInboxNotificationIds = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-tutorial-inbox-notification-id]",
    ),
  )
    .filter((element) => element.offsetParent !== null)
    .map((element) => Number(element.dataset.tutorialInboxNotificationId))
    .filter(
      (notificationId) =>
        Number.isSafeInteger(notificationId) && notificationId > 0,
    );

export const parseTutorialInboxTargets = (
  serialized: string | null,
): LearnTutorialInboxTarget[] =>
  (serialized ?? "").split(",").flatMap((pair) => {
    const parts = pair.split(":");
    const notificationId = Number(parts[0]);
    const taskId = Number(parts[1]);
    return parts.length === 2 &&
      Number.isSafeInteger(notificationId) &&
      notificationId > 0 &&
      Number.isSafeInteger(taskId) &&
      taskId > 0
      ? [{ notificationId, taskId }]
      : [];
  });

export const getRenderedTutorialInboxTargetAtIndex = (
  index: number,
): LearnTutorialInboxTarget | null => {
  const element = Array.from(
    document.querySelectorAll<HTMLElement>(
      `[data-tutorial-inbox-index="${index}"]`,
    ),
  ).find((candidate) => candidate.offsetParent !== null);
  const notificationId = Number(element?.dataset.tutorialInboxNotificationId);
  const taskId = Number(element?.dataset.tutorialInboxTaskId);
  return Number.isSafeInteger(notificationId) &&
    notificationId > 0 &&
    Number.isSafeInteger(taskId) &&
    taskId > 0
    ? { notificationId, taskId }
    : null;
};
