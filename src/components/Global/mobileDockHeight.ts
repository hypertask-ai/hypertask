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

export const clearMobileDockHeight = (
  root: HTMLElement,
  owner: object,
) => {
  const currentOwner = dockHeightOwners.get(root);
  if (currentOwner && currentOwner !== owner) return;
  if (currentOwner === owner) dockHeightOwners.delete(root);
  root.style.setProperty("--mobile-dock-h", "0px");
};
