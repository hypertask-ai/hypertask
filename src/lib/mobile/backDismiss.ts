
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
  key: string;
  onBack: () => void;
  shouldRearm?: () => boolean;
}

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
      close();
    } catch (error) {
      target.removeEventListener("popstate", handlePopState);
      reject(error);
    }
  });
};

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
