// Browser side of real-time board sync (HTPR-3626). Holds the single persistent
// connection to the pub/sub edge. The async connect path returns null when not
// configured so the app runs normally without realtime.

const KEY = process.env.NEXT_PUBLIC_PUSHER_KEY;
const HOST = process.env.NEXT_PUBLIC_PUSHER_HOST; // set for Soketi / self-host
const PORT = process.env.NEXT_PUBLIC_PUSHER_PORT;
const FORCE_TLS = process.env.NEXT_PUBLIC_PUSHER_USE_TLS === "true";
const CLUSTER = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "mt1";

type RealtimeClient = import("pusher-js").default;
type RealtimeVisibilityClient = Pick<RealtimeClient, "connect" | "disconnect"> & {
  allChannels: RealtimeClient["allChannels"];
  connection: { state: string };
};
type RealtimeIdleClient = Pick<RealtimeClient, "allChannels" | "disconnect">;
type RealtimeSubscriptionChannel = {
  name: string;
  subscribed?: boolean;
};
type RealtimeSubscriptionClient = Pick<
  RealtimeClient,
  "disconnect" | "unsubscribe"
> & {
  allChannels: () => RealtimeSubscriptionChannel[];
  connection: Pick<RealtimeClient["connection"], "bind" | "unbind">;
};
type RealtimeVisibilityDocument = Pick<
  Document,
  "addEventListener" | "removeEventListener" | "visibilityState"
>;
type RealtimePageTarget = Pick<Window, "addEventListener" | "removeEventListener">;

export const REALTIME_HIDDEN_DISCONNECT_DELAY_MS = 30_000;
export const REALTIME_IDLE_DISCONNECT_DELAY_MS = 5_000;
export const REALTIME_SUBSCRIPTION_GRACE_MS = 15_000;
export const REALTIME_DISABLED_STORAGE_KEY = "hypertask:realtime-disabled";
export const MULTIPROMPT_AGENT_MARKER =
  "__multipromptNotificationClickBridgeInstalled";

type RealtimeBrowserContext = {
  __multipromptNotificationClickBridgeInstalled?: boolean;
  location: Pick<Location, "search">;
  navigator: Pick<Navigator, "webdriver">;
  sessionStorage: Pick<Storage, "getItem" | "removeItem" | "setItem">;
} & {
  navigator: Pick<Navigator, "userAgent">;
};

let client: RealtimeClient | null = null;
let clientPromise: Promise<RealtimeClient | null> | null = null;
let removeVisibilityLifecycle: (() => void) | null = null;
let removeIdleDisconnect: (() => void) | null = null;
let removeSubscriptionWatchdog: (() => void) | null = null;
let removeAgentMarkerTrap: (() => void) | null = null;
let connectionGeneration = 0;

function updateRealtimePreference(
  storage: RealtimeBrowserContext["sessionStorage"],
  disabled: boolean,
): void {
  try {
    if (disabled) storage.setItem(REALTIME_DISABLED_STORAGE_KEY, "1");
    else storage.removeItem(REALTIME_DISABLED_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

export function realtimeDisabledForBrowser(
  browser: RealtimeBrowserContext,
): boolean {
  if (browser.__multipromptNotificationClickBridgeInstalled === true) {
    updateRealtimePreference(browser.sessionStorage, true);
    return true;
  }

  // agent-browser launches headless Chrome without the WebDriver automation
  // flag, so navigator.webdriver can be false even though no human is using
  // the tab. HeadlessChrome remains in its browser UA and is the stable signal
  // that keeps those long-lived sessions off the hosted Pusher connection cap.
  if (browser.navigator.webdriver) {
    updateRealtimePreference(browser.sessionStorage, true);
    return true;
  }

  if (/(?:HeadlessChrome|PhantomJS)/i.test(browser.navigator.userAgent)) {
    updateRealtimePreference(browser.sessionStorage, true);
    return true;
  }

  const preference = new URLSearchParams(browser.location.search).get(
    "realtime",
  );
  if (preference === "off") {
    updateRealtimePreference(browser.sessionStorage, true);
    return true;
  }
  if (preference === "on") {
    updateRealtimePreference(browser.sessionStorage, false);
    return false;
  }

  try {
    return (
      browser.sessionStorage.getItem(REALTIME_DISABLED_STORAGE_KEY) === "1"
    );
  } catch {
    return false;
  }
}

export function installRealtimeAgentMarkerTrap(
  browser: RealtimeBrowserContext,
  onAgentDetected: () => void,
): () => void {
  if (browser.__multipromptNotificationClickBridgeInstalled === true) {
    onAgentDetected();
    return () => {};
  }

  const descriptor = Object.getOwnPropertyDescriptor(
    browser,
    MULTIPROMPT_AGENT_MARKER,
  );
  if (descriptor && !descriptor.configurable) return () => {};

  let active = true;
  let value: boolean | undefined =
    browser.__multipromptNotificationClickBridgeInstalled;
  Object.defineProperty(browser, MULTIPROMPT_AGENT_MARKER, {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    get: () => value,
    set: (nextValue: boolean | undefined) => {
      value = nextValue;
      if (!active || nextValue !== true) return;
      active = false;
      Object.defineProperty(browser, MULTIPROMPT_AGENT_MARKER, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        value: true,
        writable: true,
      });
      onAgentDetected();
    },
  });

  return () => {
    if (!active) return;
    active = false;
    if (descriptor) {
      Object.defineProperty(browser, MULTIPROMPT_AGENT_MARKER, descriptor);
    } else {
      delete browser.__multipromptNotificationClickBridgeInstalled;
    }
  };
}

export function installRealtimeIdleDisconnect(args: {
  client: RealtimeIdleClient;
  disconnectDelayMs?: number;
  clearTimer?: typeof clearTimeout;
  setTimer?: typeof setTimeout;
  shouldDisconnect?: () => boolean;
}): () => void {
  const clearTimer = args.clearTimer ?? clearTimeout;
  const setTimer = args.setTimer ?? setTimeout;
  const timer = setTimer(() => {
    if (
      args.client.allChannels().length === 0 &&
      (args.shouldDisconnect?.() ?? true)
    ) {
      args.client.disconnect();
    }
  }, args.disconnectDelayMs ?? REALTIME_IDLE_DISCONNECT_DELAY_MS);

  return () => clearTimer(timer);
}

export function installRealtimeSubscriptionWatchdog(args: {
  client: RealtimeSubscriptionClient;
  graceMs?: number;
  clearTimer?: typeof clearTimeout;
  setTimer?: typeof setTimeout;
}): () => void {
  const clearTimer = args.clearTimer ?? clearTimeout;
  const setTimer = args.setTimer ?? setTimeout;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancelCheck = () => {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  };
  const closeConnectionWithoutSubscriptions = () => {
    timer = null;
    const channels = args.client.allChannels();
    if (channels.some((channel) => channel.subscribed === true)) return;

    // Remove failed/pending channel objects before disconnecting. Otherwise
    // the visibility lifecycle sees allChannels().length > 0 and reconnects a
    // socket that can never deliver realtime events.
    channels.forEach((channel) => args.client.unsubscribe(channel.name));
    args.client.disconnect();
  };
  const scheduleCheck = () => {
    cancelCheck();
    timer = setTimer(
      closeConnectionWithoutSubscriptions,
      args.graceMs ?? REALTIME_SUBSCRIPTION_GRACE_MS,
    );
  };

  args.client.connection.bind("connected", scheduleCheck);
  scheduleCheck();

  return () => {
    cancelCheck();
    args.client.connection.unbind("connected", scheduleCheck);
  };
}

function cancelRealtimeIdleDisconnect(): void {
  removeIdleDisconnect?.();
  removeIdleDisconnect = null;
}

function ensureRealtimeAgentMarkerTrap(browser: RealtimeBrowserContext): void {
  if (removeAgentMarkerTrap) return;
  removeAgentMarkerTrap = installRealtimeAgentMarkerTrap(browser, () => {
    updateRealtimePreference(browser.sessionStorage, true);
    void connectRealtimeClient();
  });
}

export function releaseRealtimeClientIfIdle(
  activeClient: RealtimeClient,
): void {
  if (client !== activeClient) return;
  cancelRealtimeIdleDisconnect();
  removeIdleDisconnect = installRealtimeIdleDisconnect({
    client: activeClient,
    shouldDisconnect: () => client === activeClient,
  });
}

export function realtimeConnectionAttemptAllowed(
  browser: RealtimeBrowserContext,
  attemptGeneration: number,
  currentGeneration: number,
): boolean {
  return (
    attemptGeneration === currentGeneration &&
    !realtimeDisabledForBrowser(browser)
  );
}

export function waitForVisibleDocument(
  documentTarget: RealtimeVisibilityDocument,
): Promise<void> {
  if (documentTarget.visibilityState !== "hidden") return Promise.resolve();

  return new Promise((resolve) => {
    const onVisibilityChange = () => {
      if (documentTarget.visibilityState === "hidden") return;
      documentTarget.removeEventListener("visibilitychange", onVisibilityChange);
      resolve();
    };
    documentTarget.addEventListener("visibilitychange", onVisibilityChange);
  });
}

export function installRealtimeVisibilityLifecycle(args: {
  client: RealtimeVisibilityClient;
  documentTarget: RealtimeVisibilityDocument;
  pageTarget: RealtimePageTarget;
  disconnectDelayMs?: number;
  clearTimer?: typeof clearTimeout;
  setTimer?: typeof setTimeout;
}): () => void {
  const disconnectDelayMs =
    args.disconnectDelayMs ?? REALTIME_HIDDEN_DISCONNECT_DELAY_MS;
  const clearTimer = args.clearTimer ?? clearTimeout;
  const setTimer = args.setTimer ?? setTimeout;
  let hiddenTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelHiddenDisconnect = () => {
    if (hiddenTimer === null) return;
    clearTimer(hiddenTimer);
    hiddenTimer = null;
  };
  const connectIfNeeded = () => {
    cancelHiddenDisconnect();
    if (args.client.allChannels().length === 0) return;
    if (args.client.connection.state === "disconnected") {
      args.client.connect();
    }
  };
  const scheduleHiddenDisconnect = () => {
    if (hiddenTimer !== null) return;
    hiddenTimer = setTimer(() => {
      hiddenTimer = null;
      if (args.documentTarget.visibilityState === "hidden") {
        args.client.disconnect();
      }
    }, disconnectDelayMs);
  };
  const syncVisibility = () => {
    if (args.documentTarget.visibilityState === "hidden") {
      scheduleHiddenDisconnect();
    } else {
      connectIfNeeded();
    }
  };
  const onPageHide = () => {
    cancelHiddenDisconnect();
    args.client.disconnect();
  };

  args.documentTarget.addEventListener("visibilitychange", syncVisibility);
  args.pageTarget.addEventListener("pagehide", onPageHide);
  args.pageTarget.addEventListener("pageshow", syncVisibility);
  syncVisibility();

  return () => {
    cancelHiddenDisconnect();
    args.documentTarget.removeEventListener("visibilitychange", syncVisibility);
    args.pageTarget.removeEventListener("pagehide", onPageHide);
    args.pageTarget.removeEventListener("pageshow", syncVisibility);
  };
}

export function getRealtimeClient(): RealtimeClient | null {
  return client;
}

export async function connectRealtimeClient(): Promise<RealtimeClient | null> {
  if (typeof window === "undefined") return null;
  if (realtimeDisabledForBrowser(window)) {
    connectionGeneration += 1;
    clientPromise = null;
    cancelRealtimeIdleDisconnect();
    removeSubscriptionWatchdog?.();
    removeSubscriptionWatchdog = null;
    removeAgentMarkerTrap?.();
    removeAgentMarkerTrap = null;
    removeVisibilityLifecycle?.();
    removeVisibilityLifecycle = null;
    client?.disconnect();
    client = null;
    return null;
  }
  if (!KEY) return null;
  ensureRealtimeAgentMarkerTrap(window);
  cancelRealtimeIdleDisconnect();
  if (client) {
    if (
      document.visibilityState !== "hidden" &&
      client.connection.state === "disconnected"
    ) {
      client.connect();
    }
    return client;
  }
  if (!clientPromise) {
    const attemptGeneration = connectionGeneration;
    clientPromise = waitForVisibleDocument(document)
      .then(() => import("pusher-js"))
      .catch(() => {
        // Transient chunk-load failure must not poison realtime for the whole
        // session: reset so a later hook mount retries the import.
        if (attemptGeneration !== connectionGeneration) return null;
        clientPromise = null;
        return null;
      })
      .then((mod) => {
        if (!mod) return null;
        if (
          !realtimeConnectionAttemptAllowed(
            window,
            attemptGeneration,
            connectionGeneration,
          )
        ) {
          if (attemptGeneration === connectionGeneration) clientPromise = null;
          return null;
        }
        const Pusher = mod.default;
        client = new Pusher(KEY, {
          cluster: CLUSTER,
          forceTLS: FORCE_TLS,
          authEndpoint: "/api/pusher/auth",
          // Soketi / self-host: pin host+port. Hosted Pusher ignores these.
          ...(HOST
            ? {
                wsHost: HOST,
                wsPort: PORT ? Number(PORT) : 6001,
                wssPort: PORT ? Number(PORT) : 6001,
                enabledTransports: ["ws", "wss"],
                disableStats: true,
              }
            : {}),
        });
        removeVisibilityLifecycle?.();
        removeVisibilityLifecycle = installRealtimeVisibilityLifecycle({
          client,
          documentTarget: document,
          pageTarget: window,
        });
        removeSubscriptionWatchdog?.();
        removeSubscriptionWatchdog = installRealtimeSubscriptionWatchdog({
          client,
        });
        releaseRealtimeClientIfIdle(client);
        return client;
      });
  }
  return clientPromise;
}

// This tab's Pusher socket id, sent with mutations (X-Socket-Id header) so the
// server can exclude this tab from its own broadcast echo (HTPR-3998). The
// acting tab already updates its cache optimistically; the echo just forced a
// full inbox refetch per action. undefined while disconnected — that's fine,
// the mutation then broadcasts to everyone (at worst the old behaviour).
export function getRealtimeSocketId(): string | undefined {
  return client?.connection?.socket_id || undefined;
}

// Header object for mutation requests: identifies this tab's socket so the
// server-side broadcast can skip echoing back to it. Empty when disconnected.
export function realtimeEchoHeaders(): Record<string, string> {
  const socketId = getRealtimeSocketId();
  return socketId ? { "X-Socket-Id": socketId } : {};
}
