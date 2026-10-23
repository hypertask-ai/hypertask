type ShownToast = { id: string; visible: boolean; type?: string; createdAt?: number };

const newerThan = (toast: ShownToast, other: ShownToast | undefined) =>
  !other || (toast.createdAt ?? 0) > (other.createdAt ?? 0);

export const toastIdsToDismiss = (
  newestFirstToasts: ShownToast[],
  newestFirstUndoToasts: ShownToast[],
) => {
  const visible = newestFirstToasts.filter((item) => item.visible);
  const visibleUndo = newestFirstUndoToasts.filter((item) => item.visible);
  const newestError = visible.find((item) => item.type === "error");
  if (newestError && newerThan(newestError, visibleUndo[0])) {
    return {
      toasts: visible.filter((item) => item !== newestError).map((item) => item.id),
      undoToasts: visibleUndo.map((item) => item.id),
    };
  }
  const ids = visible.map((item) => item.id);
  return { toasts: visibleUndo.length > 0 ? ids : ids.slice(1), undoToasts: [] };
};
