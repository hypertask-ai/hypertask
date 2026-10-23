export const toastIdsToDismiss = (
  newestFirstToasts: { id: string; visible: boolean }[],
  undoToastShowing: boolean,
) => {
  const visible = newestFirstToasts.filter((item) => item.visible).map((item) => item.id);
  return undoToastShowing ? visible : visible.slice(1);
};
