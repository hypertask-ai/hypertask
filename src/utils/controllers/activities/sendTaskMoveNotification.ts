export async function sendTaskMoveNotificationIfNeeded(
  moveActivity: { shouldNotify: boolean },
  sendNotification: () => Promise<unknown>,
  onError: (error: unknown) => void = (error) =>
    console.warn("[task-move] Notification delivery failed after a successful move.", error),
): Promise<boolean> {
  if (!moveActivity.shouldNotify) return false;

  try {
    await sendNotification();
    return true;
  } catch (error) {
    onError(error);
    return false;
  }
}
