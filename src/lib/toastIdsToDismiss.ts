type ShownToast = { id: string; visible: boolean; type?: string };

export const toastIdsToDismiss = (
  newestFirstToasts: ShownToast[],
  newestFirstUndoToasts: ShownToast[],
) => {
  const visible = newestFirstToasts.filter((item) => item.visible);
  const visibleUndo = newestFirstUndoToasts.filter((item) => item.visible).map((item) => item.id);
  const newestError = visible.find((item) => item.type === "error");
  if (newestError) {
    return {
      toasts: visible.filter((item) => item !== newestError).map((item) => item.id),
      undoToasts: visibleUndo,
    };
  }
  const ids = visible.map((item) => item.id);
  return { toasts: visibleUndo.length > 0 ? ids : ids.slice(1), undoToasts: [] };
};
