export type EarlyBoardBootstrapRequest = "projectsAll" | "boardTasks";

type EarlyBoardBootstrapResult =
  { ok: true; data: unknown } | { ok: false; status?: number };

type EarlyBoardBootstrapState = {
  accountId: number;
  projectId: number;
  expiresAt: number;
  requests: Partial<
    Record<EarlyBoardBootstrapRequest, Promise<EarlyBoardBootstrapResult>>
  >;
};

const EARLY_BOARD_BOOTSTRAP_TTL_MS = 30_000;
const BOARD_READINESS_MARK_NAMES = [
  "ht-board-bootstrap-start",
  "ht-board-auth-available",
  "ht-board-projects-request-start",
  "ht-board-projects-fallback-start",
  "ht-board-projects-request-finish",
  "ht-board-tasks-request-start",
  "ht-board-tasks-fallback-start",
  "ht-board-tasks-request-finish",
  "ht-board-local-read-start",
  "ht-board-local-read-finish",
  "ht-board-query-published",
  "ht-board-network-query-published",
  "ht-board-first-commit",
  "ht-board-usable-ready",
] as const;

declare global {
  interface Window {
    __htEarlyBoardBootstrap?: EarlyBoardBootstrapState;
  }
}

/**
 * Build the tiny parser-time bootstrap used on a full authenticated board load.
 *
 * The API routes still authenticate every request from the HTTP-only session.
 * The script only moves request start ahead of the large client hydration graph.
 * Every promise settles to a result object so an early failure cannot surface as
 * an unhandled rejection before React Query attaches a consumer.
 */
export const buildEarlyBoardBootstrapScript = ({
  accountId,
  projectId,
}: {
  accountId: number;
  projectId: number;
}): string => {
  const serializedAccountId = JSON.stringify(accountId);
  const serializedProjectId = JSON.stringify(projectId);
  const serializedReadinessMarks = JSON.stringify(
    BOARD_READINESS_MARK_NAMES,
  );

  return `(function(){
    var accountId=${serializedAccountId};
    var projectId=${serializedProjectId};
    var readiness=window.__htBoardReadinessRuntime;
    var hasReadinessEntry=readiness&&(
      typeof readiness.accountId==="number"||
      typeof readiness.projectId==="number"||
      readiness.completion||readiness.emitted||readiness.fallbackTimer!==undefined
    );
    if(!readiness||readiness.accountId!==accountId||readiness.projectId!==projectId){
      var nextReadinessGeneration=readiness&&typeof readiness.generation==="number"
        ?readiness.generation+1
        :0;
      if(readiness&&readiness.fallbackTimer!==undefined&&typeof window.clearTimeout==="function"){
        window.clearTimeout(readiness.fallbackTimer);
      }
      if(hasReadinessEntry&&window.performance&&typeof window.performance.clearMarks==="function"){
        ${serializedReadinessMarks}.forEach(function(name){window.performance.clearMarks(name);});
      }
      window.__htBoardReadinessRuntime={
        accountId:accountId,
        projectId:projectId,
        generation:nextReadinessGeneration
      };
    }else if(typeof readiness.generation!=="number"){
      readiness.generation=0;
    }
    readiness=window.__htBoardReadinessRuntime;
    var current=window.__htEarlyBoardBootstrap;
    if(current&&current.accountId===accountId&&current.projectId===projectId){return;}
    function mark(name){
      if(window.__htBoardReadinessRuntime!==readiness){return;}
      if(!window.performance||typeof window.performance.mark!=="function"){return;}
      if(typeof window.performance.getEntriesByName==="function"&&window.performance.getEntriesByName(name,"mark").length>0){return;}
      window.performance.mark(name);
    }
    function request(name,url,init){
      mark(name+"-start");
      return window.fetch(url,init).then(function(response){
        if(!response.ok){return {ok:false,status:response.status};}
        return response.json().then(
          function(data){return {ok:true,data:data};},
          function(){return {ok:false,status:response.status};}
        );
      },function(){return {ok:false};}).then(function(result){
        mark(name+"-early-finish");
        if(result.ok){mark(name+"-finish");}
        return result;
      });
    }
    var headers={"Content-Type":"application/json"};
    mark("ht-board-bootstrap-start");
    mark("ht-board-auth-available");
    window.__htEarlyBoardBootstrap={
      accountId:accountId,
      projectId:projectId,
      expiresAt:Date.now()+${EARLY_BOARD_BOOTSTRAP_TTL_MS},
      requests:{
        projectsAll:request("ht-board-projects-request","/api/projects/getAll",{
          method:"POST",
          credentials:"include",
          headers:headers,
          body:JSON.stringify({userId:accountId,projectId:projectId})
        }),
        boardTasks:request("ht-board-tasks-request","/api/projects/boardTasks",{
          method:"POST",
          credentials:"include",
          headers:headers,
          body:JSON.stringify({projectId:projectId,userId:accountId})
        })
      }
    };
  })();`;
};

/**
 * Consume a matching parser-time request once. Subsequent refetches must use the
 * normal network path rather than replaying the initial response indefinitely.
 */
export const consumeEarlyBoardBootstrap = async <T>(
  requestName: EarlyBoardBootstrapRequest,
  accountId: number,
  projectId: number,
): Promise<T | undefined> => {
  if (typeof window === "undefined") return undefined;

  const bootstrap = window.__htEarlyBoardBootstrap;
  if (bootstrap && Date.now() > bootstrap.expiresAt) {
    delete window.__htEarlyBoardBootstrap;
    return undefined;
  }
  if (
    !bootstrap ||
    bootstrap.accountId !== accountId ||
    bootstrap.projectId !== projectId
  ) {
    return undefined;
  }

  const request = bootstrap.requests[requestName];
  if (!request) return undefined;
  delete bootstrap.requests[requestName];

  const result = await request;
  return result.ok ? (result.data as T) : undefined;
};

/**
 * A fresh persisted React Query snapshot can satisfy the initial board query
 * without invoking its query function. Drop the now-unused parser promises so
 * a later realtime or focus refetch cannot mistake them for fresh network data.
 */
export const discardEarlyBoardBootstrap = (
  accountId: number,
  projectId: number,
  requestName?: EarlyBoardBootstrapRequest,
): void => {
  if (typeof window === "undefined") return;

  const bootstrap = window.__htEarlyBoardBootstrap;
  if (
    bootstrap?.accountId === accountId &&
    bootstrap.projectId === projectId
  ) {
    if (!requestName) {
      delete window.__htEarlyBoardBootstrap;
      return;
    }

    delete bootstrap.requests[requestName];
    if (Object.keys(bootstrap.requests).length === 0) {
      delete window.__htEarlyBoardBootstrap;
    }
  }
};
