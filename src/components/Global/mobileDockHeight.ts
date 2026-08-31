const dockHeightOwners = new WeakMap<HTMLElement, object>();

export const publishMobileDockHeight = (
  root: HTMLElement,
  owner: object,
  height: string,
) => {
  dockHeightOwners.set(root, owner);
  root.style.setProperty("--mobile-dock-h", height);
};

export const releaseMobileDockHeight = (
  root: HTMLElement,
  owner: object,
) => {
  if (dockHeightOwners.get(root) !== owner) return;
  dockHeightOwners.delete(root);
  root.style.removeProperty("--mobile-dock-h");
};
