import type {
  AppShellBootstrapPayload,
  AppShellBootstrapSliceKey,
} from "./types";

const APP_SHELL_BOOTSTRAP_TTL_MS = 30_000;

type BootstrapRequestResult =
  | { ok: true; payload: AppShellBootstrapPayload }
  | { ok: false };

type AppShellBootstrapState = {
  accountId: number;
  expiresAt: number;
  request: Promise<BootstrapRequestResult>;
  consumed: Partial<Record<AppShellBootstrapSliceKey, boolean>>;
  slicePromises: Partial<
    Record<AppShellBootstrapSliceKey, Promise<unknown | undefined>>
  >;
};

declare global {
  interface Window {
    __htAppShellBootstrap?: AppShellBootstrapState;
  }
}

export const buildEarlyAppShellBootstrapScript = ({
  accountId,
  betterAuthEnabled,
}: {
  accountId: number;
  betterAuthEnabled: boolean;
}): string => {
  const endpoint = betterAuthEnabled
    ? "/api/auth/bridge-session"
    : "/api/app-shell/bootstrap";

  return `(function(){
    var accountId=${JSON.stringify(accountId)};
    var current=window.__htAppShellBootstrap;
    if(current&&current.accountId===accountId&&Date.now()<=current.expiresAt){return;}
    var request=window.fetch(${JSON.stringify(endpoint)}, {
      method:"POST",
      credentials:"include",
      cache:"no-store",
      headers:{"Content-Type":"application/json"}
    }).then(function(response){
      if(!response.ok){return {ok:false};}
      return response.json().then(function(body){
        var payload=body&&body.bootstrap?body.bootstrap:body;
        if(!payload||payload.accountId!==accountId||!payload.slices||typeof payload.slices!=="object"){
          return {ok:false};
        }
        return {ok:true,payload:payload};
      },function(){return {ok:false};});
    },function(){return {ok:false};});
    window.__htAppShellBootstrap={
      accountId:accountId,
      expiresAt:Date.now()+${APP_SHELL_BOOTSTRAP_TTL_MS},
      request:request,
      consumed:{},
      slicePromises:{}
    };
  })();`;
};

const getBootstrapState = (
  expectedAccountId?: number,
): AppShellBootstrapState | undefined => {
  if (typeof window === "undefined") return undefined;
  const state = window.__htAppShellBootstrap;
  if (
    !state ||
    Date.now() > state.expiresAt ||
    (expectedAccountId !== undefined && state.accountId !== expectedAccountId)
  ) {
    if (state && Date.now() > state.expiresAt) {
      delete window.__htAppShellBootstrap;
    }
    return undefined;
  }
  return state;
};

export const waitForEarlyAppShellBootstrap = async (
  expectedAccountId: number,
): Promise<boolean> => {
  const state = getBootstrapState(expectedAccountId);
  if (!state) return false;
  const result = await state.request;
  return result.ok && result.payload.accountId === expectedAccountId;
};

export const consumeEarlyAppShellBootstrapSlice = async <T>(
  key: AppShellBootstrapSliceKey,
  expectedAccountId?: number,
): Promise<T | undefined> => {
  const state = getBootstrapState(expectedAccountId);
  if (!state || state.consumed[key]) return undefined;

  const pending = state.slicePromises[key];
  if (pending) return pending as Promise<T | undefined>;

  const slicePromise = state.request
    .then((result) => {
      if (!result.ok || result.payload.accountId !== state.accountId) {
        return undefined;
      }
      const slice = result.payload.slices[key];
      return slice?.ok ? (slice.data as T) : undefined;
    })
    .finally(() => {
      state.consumed[key] = true;
      delete state.slicePromises[key];
    });
  state.slicePromises[key] = slicePromise;
  return slicePromise;
};
