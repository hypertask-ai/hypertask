export type NavigationHistoryLike = {
  entries?: () => ArrayLike<{ url?: string }>;
  currentEntry?: { index?: number } | null;
};

export type PageReturnStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export type PageReturnHistoryLike = {
  readonly state: unknown;
  replaceState: (data: unknown, unused: string, url?: string | URL | null) => void;
};

export type PageReturnRuntime = Window &
  typeof globalThis & {
    __hypertaskPageReturnPending?: Set<string>;
  };

type PageRouter = {
  back: () => void;
  replace: (href: string) => void;
};

type StoredPageReturnContext = {
  version: 1;
  nonce: string;
  pagePathname: string;
  taskUrl: string;
  createdAt: number;
  entryBound: boolean;
};

type CreatePageReturnHrefOptions = {
  pageHref: string;
  taskHref: string;
  sourceHref: string;
  currentOrigin: string;
  storage: PageReturnStorage;
  runtime: PageReturnRuntime;
  nonce: string;
  now?: number;
};

type ReturnFromPageOptions = {
  router: PageRouter;
  navigation?: NavigationHistoryLike | null;
  historyState: unknown;
  currentHref: string;
  taskHref: string;
  storage: PageReturnStorage;
  now?: number;
};

type BindPageReturnEntryOptions = {
  currentHref: string;
  taskHref: string;
  storage: PageReturnStorage;
  history: PageReturnHistoryLike;
  runtime: PageReturnRuntime;
  now?: number;
};

export const PAGE_RETURN_CONTEXT_PARAM = "page_return";
const PAGE_RETURN_CONTEXT_PREFIX = "hypertask:page-return:";
const PAGE_RETURN_HISTORY_STATE_KEY = "__hypertaskPageReturn";
export const PAGE_RETURN_CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

const contextKey = (nonce: string) => `${PAGE_RETURN_CONTEXT_PREFIX}${nonce}`;

const pendingRuntimeProofs = (runtime: PageReturnRuntime, create: boolean) => {
  if (runtime.__hypertaskPageReturnPending || !create) {
    return runtime.__hypertaskPageReturnPending;
  }

  Object.defineProperty(runtime, "__hypertaskPageReturnPending", {
    configurable: true,
    value: new Set<string>(),
  });
  return runtime.__hypertaskPageReturnPending;
};

export const hasPageReturnRuntimeProof = (
  runtime: PageReturnRuntime,
  nonce: string,
) => pendingRuntimeProofs(runtime, false)?.has(nonce) === true;

const markPageReturnRuntimeProof = (
  runtime: PageReturnRuntime,
  nonce: string,
) => {
  pendingRuntimeProofs(runtime, true)?.add(nonce);
};

const clearPageReturnRuntimeProof = (
  runtime: PageReturnRuntime,
  nonce: string,
) => {
  const pending = pendingRuntimeProofs(runtime, false);
  pending?.delete(nonce);
  if (pending?.size === 0) {
    delete runtime.__hypertaskPageReturnPending;
  }
};

const isTaskEntry = (
  entryUrl: string,
  taskHref: string,
  currentOrigin: string,
) => {
  try {
    const entry = new URL(entryUrl);
    const task = new URL(taskHref, currentOrigin);

    // Query and hash carry inbox/comment context, but do not change the task.
    return entry.origin === task.origin && entry.pathname === task.pathname;
  } catch {
    return false;
  }
};

const isExactEntry = (entryUrl: string, expectedUrl: string) => {
  try {
    return new URL(entryUrl).href === new URL(expectedUrl).href;
  } catch {
    return false;
  }
};

const relativeHref = (url: URL) => `${url.pathname}${url.search}${url.hash}`;

/**
 * Records an internal task → Page transition and returns a marker-bearing Page
 * href. The pending nonce also lives on this Window until the first Page entry
 * binds it, so a new tab cannot inherit authority by cloning sessionStorage.
 */
export const createPageReturnHref = ({
  pageHref,
  taskHref,
  sourceHref,
  currentOrigin,
  storage,
  runtime,
  nonce,
  now = Date.now(),
}: CreatePageReturnHrefOptions) => {
  try {
    if (!NONCE_PATTERN.test(nonce)) return pageHref;

    const page = new URL(pageHref, currentOrigin);
    const task = new URL(taskHref, currentOrigin);
    const source = new URL(sourceHref);
    if (
      page.origin !== currentOrigin ||
      task.origin !== currentOrigin ||
      source.origin !== currentOrigin ||
      source.pathname !== task.pathname
    ) {
      return pageHref;
    }

    const context: StoredPageReturnContext = {
      version: 1,
      nonce,
      pagePathname: page.pathname,
      taskUrl: source.href,
      createdAt: now,
      entryBound: false,
    };
    storage.setItem(contextKey(nonce), JSON.stringify(context));
    markPageReturnRuntimeProof(runtime, nonce);
    page.searchParams.set(PAGE_RETURN_CONTEXT_PARAM, nonce);
    return relativeHref(page);
  } catch {
    // Storage can be unavailable in privacy modes. A plain Page link remains
    // usable; the return control will take the safe replace path.
    return pageHref;
  }
};

const readPageReturnContext = ({
  currentHref,
  taskHref,
  storage,
  now,
}: Pick<ReturnFromPageOptions, "currentHref" | "taskHref" | "storage"> & {
  now: number;
}) => {
  try {
    const current = new URL(currentHref);
    const nonce = current.searchParams.get(PAGE_RETURN_CONTEXT_PARAM);
    if (!nonce || !NONCE_PATTERN.test(nonce)) return null;

    const key = contextKey(nonce);
    const raw = storage.getItem(key);
    if (!raw) return null;

    const context = JSON.parse(raw) as Partial<StoredPageReturnContext>;
    const age = now - Number(context.createdAt);
    if (
      context.version !== 1 ||
      context.nonce !== nonce ||
      context.pagePathname !== current.pathname ||
      typeof context.taskUrl !== "string" ||
      typeof context.entryBound !== "boolean" ||
      !Number.isFinite(age) ||
      age < 0 ||
      age > PAGE_RETURN_CONTEXT_TTL_MS ||
      !isTaskEntry(context.taskUrl, taskHref, current.origin)
    ) {
      storage.removeItem(key);
      return null;
    }

    return {
      key,
      nonce,
      taskUrl: context.taskUrl,
      context: context as StoredPageReturnContext,
    };
  } catch {
    return null;
  }
};

const historyStateHasPageReturn = (state: unknown, nonce: string) => {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  const marker = (state as Record<string, unknown>)[
    PAGE_RETURN_HISTORY_STATE_KEY
  ];
  return (
    marker !== null &&
    typeof marker === "object" &&
    !Array.isArray(marker) &&
    (marker as Record<string, unknown>).version === 1 &&
    (marker as Record<string, unknown>).nonce === nonce
  );
};

/**
 * Binds a pending task → Page marker to this exact session-history entry.
 * A first bind requires the pending nonce on this live Window. Once bound,
 * `history.state` survives reloads but is not carried by a copied URL or later
 * revisit. The storage flag prevents another entry from binding it again.
 */
export const bindPageReturnEntry = ({
  currentHref,
  taskHref,
  storage,
  history,
  runtime,
  now = Date.now(),
}: BindPageReturnEntryOptions) => {
  const stored = readPageReturnContext({
    currentHref,
    taskHref,
    storage,
    now,
  });
  if (!stored) return false;

  if (stored.context.entryBound) {
    return historyStateHasPageReturn(history.state, stored.nonce);
  }
  if (!hasPageReturnRuntimeProof(runtime, stored.nonce)) return false;

  try {
    const currentState =
      history.state &&
      typeof history.state === "object" &&
      !Array.isArray(history.state)
        ? (history.state as Record<string, unknown>)
        : {};
    history.replaceState(
      {
        ...currentState,
        [PAGE_RETURN_HISTORY_STATE_KEY]: {
          version: 1,
          nonce: stored.nonce,
        },
      },
      "",
      currentHref,
    );
    storage.setItem(
      stored.key,
      JSON.stringify({ ...stored.context, entryBound: true }),
    );
    clearPageReturnRuntimeProof(runtime, stored.nonce);
    return true;
  } catch {
    return false;
  }
};

const inspectPreviousEntry = (navigation?: NavigationHistoryLike | null) => {
  try {
    const entries = navigation?.entries?.();
    const currentIndex = navigation?.currentEntry?.index;
    if (!entries || typeof currentIndex !== "number") {
      return { supported: false, url: null } as const;
    }

    const previousUrl = currentIndex > 0 ? entries[currentIndex - 1]?.url : null;
    return {
      supported: true,
      url: typeof previousUrl === "string" ? previousUrl : null,
    } as const;
  } catch {
    return { supported: false, url: null } as const;
  }
};

/**
 * Returns from a Page without pushing a duplicate task entry.
 *
 * The Navigation API can prove the immediate predecessor directly. Other
 * browsers may use Back only when the task → Page nonce is bound to this exact
 * history entry. Direct, copied, and replayed visits replace the Page safely.
 */
export const returnFromPage = ({
  router,
  navigation,
  historyState,
  currentHref,
  taskHref,
  storage,
  now = Date.now(),
}: ReturnFromPageOptions) => {
  const context = readPageReturnContext({
    currentHref,
    taskHref,
    storage,
    now,
  });
  const previous = inspectPreviousEntry(navigation);
  const hasBoundContext =
    context !== null &&
    context.context.entryBound &&
    historyStateHasPageReturn(historyState, context.nonce);
  const provenByNavigation =
    hasBoundContext &&
    previous.supported &&
    previous.url !== null &&
    isExactEntry(previous.url, context.taskUrl);
  const provenByMarker = hasBoundContext && !previous.supported;

  if (provenByNavigation || provenByMarker) {
    if (context) {
      try {
        storage.removeItem(context.key);
      } catch {
        // A storage policy change must not prevent a verified navigation.
      }
    }
    router.back();
    return "back" as const;
  }

  if (context) {
    try {
      storage.removeItem(context.key);
    } catch {
      // The same-origin validated task URL is still a safe replacement.
    }
  }
  router.replace(
    context ? relativeHref(new URL(context.taskUrl)) : taskHref,
  );
  return "replace" as const;
};
