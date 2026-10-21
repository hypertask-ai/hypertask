let archiveKeyIsDown = false;
let releaseListenersInstalled = false;

type ArchiveShortcutEvent = { repeat?: boolean };
type ArchiveShortcutReleaseEvent = {
  code?: string;
  key?: string;
  keyCode?: number;
};

function isArchiveKey(event: ArchiveShortcutReleaseEvent): boolean {
  return (
    event.code === "KeyE" ||
    event.key?.toLowerCase() === "e" ||
    event.keyCode === 69
  );
}

export function handleArchiveShortcutKeyUp(
  event: ArchiveShortcutReleaseEvent,
): void {
  if (isArchiveKey(event)) archiveKeyIsDown = false;
}

function installReleaseListeners(): void {
  if (releaseListenersInstalled || typeof document === "undefined") return;

  document.addEventListener("keyup", handleArchiveShortcutKeyUp, true);
  window.addEventListener("blur", resetArchiveShortcutGuard);
  releaseListenersInstalled = true;
}

export function shouldRunArchiveShortcut(event: ArchiveShortcutEvent): boolean {
  installReleaseListeners();
  if (event.repeat || archiveKeyIsDown) return false;
  archiveKeyIsDown = true;
  return true;
}

export function resetArchiveShortcutGuard(): void {
  archiveKeyIsDown = false;
}
