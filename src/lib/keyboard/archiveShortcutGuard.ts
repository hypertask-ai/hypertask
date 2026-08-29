// Ctrl/Cmd+E archives the selected task. Archiving immediately advances the
// selection to the next card, and then into the next column once a column runs
// out, so one held key can wipe out several tasks the user never aimed at.
//
// `event.repeat` catches the common case, but it is not dependable everywhere:
// X11-style auto-repeat, remote desktops, and some keyboard layers deliver a
// held key as discrete presses with `repeat === false`. Track the physical E
// key state too, so those events remain blocked until the browser reports a
// release. A release clears the guard immediately, with no cooldown between
// deliberate taps.
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

// Tests, surface switches, and window blur start from a clean slate.
export function resetArchiveShortcutGuard(): void {
  archiveKeyIsDown = false;
}
