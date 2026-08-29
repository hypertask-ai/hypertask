/**
 * System-back dismissal for full-screen mobile modals.
 *
 * A full-screen modal has no backdrop to tap, so the phone's back gesture is the
 * only exit users reach for. Arming pushes one history entry; the next back
 * gesture pops it and dismisses the modal instead of leaving the board.
 */

export interface BackDismissHistory {
  state: any;
  pushState: (state: any, title: string, url?: string) => void;
  back: () => void;
}

export interface BackDismissTarget {
  history: BackDismissHistory;
  location: { href: string };
  addEventListener: (type: "popstate", listener: () => void) => void;
  removeEventListener: (type: "popstate", listener: () => void) => void;
}

export interface BackDismissOptions {
  /** History-state marker so unrelated entries are never mistaken for ours. */
  key: string;
  /** Runs when the back gesture pops our entry. */
  onBack: () => void;
  /**
   * Return true when the modal is still open after `onBack` (for example a
   * discard confirmation took over). The entry is re-armed so back keeps
   * working instead of navigating away from the board.
   */
  shouldRearm?: () => boolean;
}

/**
 * Closes a modal and waits for its temporary history entry to be removed before
 * another route is pushed on top of it.
 */
export const closeBackDismissBeforeNavigation = (
  target: BackDismissTarget,
  key: string,
  close: () => void,
): Promise<void> => {
  if (!target.history.state?.[key]) {
    close();
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const handlePopState = () => {
      target.removeEventListener("popstate", handlePopState);
      resolve();
    };

    target.addEventListener("popstate", handlePopState);
    try {
      // Closing unmounts the modal and its back-dismiss cleanup pops the
      // temporary entry. Wait for that pop before adding the destination route.
      close();
    } catch (error) {
      target.removeEventListener("popstate", handlePopState);
      reject(error);
    }
  });
};

/**
 * Arms back dismissal and returns a disarm function. Disarming while the entry
 * is still on the stack removes it, so other close controls leave no dead step.
 */
export const armBackDismiss = (
  target: BackDismissTarget,
  { key, onBack, shouldRearm }: BackDismissOptions,
): (() => void) => {
  let armed = false;

  const push = () => {
    target.history.pushState(
      { ...(target.history.state ?? {}), [key]: true },
      "",
      target.location.href,
    );
    armed = true;
  };

  const handlePopState = () => {
    if (!armed) return;
    armed = false;
    onBack();
    if (shouldRearm?.()) push();
  };

  push();
  target.addEventListener("popstate", handlePopState);

  return () => {
    target.removeEventListener("popstate", handlePopState);
    if (!armed) return;
    armed = false;
    target.history.back();
  };
};
