const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const historySource = fs.readFileSync(
  path.join(root, "src/hooks/MultiPages/AIChat/useSessionAndChatHistory.ts"),
  "utf8"
);
const chatSource = fs.readFileSync(
  path.join(root, "src/hooks/MultiPages/AIChat/useAiChat.ts"),
  "utf8"
);
const commentSource = fs.readFileSync(
  path.join(root, "src/hooks/MultiPages/AIChat/useCommentToAiChat.ts"),
  "utf8"
);

test("closed chat does not request session history", () => {
  assert.match(
    historySource,
    /enabled: historyEnabled && hasRequiredData && !isDemo/
  );
  assert.match(
    chatSource,
    /isFullScreenChat \|\| showAiChatInterface \|\| chatMounted/
  );
  assert.match(
    chatSource,
    /useSessionAndChatHistory\(taskId, shouldLoadChatHistory, isDetailPage\)/
  );
});

test("first-open summarize waits for the deferred session", () => {
  assert.match(commentSource, /const waitForSession = async/);
  assert.match(commentSource, /openChat\(\);[\s\S]*?waitForSession\(\)/);
  assert.match(commentSource, /handleSendMessageRef\.current/);
});

test("deferred and manual sends share a synchronous mutex", () => {
  assert.match(chatSource, /const sendInFlightRef = useRef\(false\)/);
  // BYOK and in-flight guards may be split so streaming can enqueue follow-ups
  // (HTPR-5695) without weakening the pre-stream double-send mutex.
  assert.match(chatSource, /if \(isByokBlocked\) return;/);
  assert.match(chatSource, /if \(sendInFlightRef\.current\) return;/);
  assert.match(chatSource, /sendInFlightRef\.current = true/);
  assert.match(chatSource, /sendInFlightRef\.current = false/);
  assert.match(commentSource, /sessionReady \|\| isTypingRef\.current/);
});

test("first-open manual send waits for a session before dereferencing it", () => {
  assert.match(chatSource, /const waitForChatSession = async/);
  assert.match(chatSource, /const session = await waitForChatSession\(\)/);
  assert.match(chatSource, /if \(!session\) \{/);
  assert.doesNotMatch(
    chatSource.slice(
      chatSource.indexOf("const handleSendMessage = async"),
      chatSource.indexOf("const dropDownButtonAICallback")
    ),
    /sessions\[0\]/
  );
});

test("first-open sends wait for board-specific session initialization", () => {
  assert.match(
    chatSource,
    /const ensureSessionForCurrentBoard = useCallback/,
    "board session selection must be centralized"
  );
  assert.match(
    chatSource,
    /sessionSetupRef\.current = \{ key: setupKey, promise \}/,
    "board session setup must publish one shared in-flight promise"
  );
  assert.match(
    chatSource,
    /const waitForChatSession = async[\s\S]*?return ensureSessionForCurrentBoard\(timeoutMs\)/,
    "every send must use the same board-session operation as automatic setup"
  );
  assert.match(historySource, /setActiveSession\(newSessionId\);[\s\S]*?return newSession;/);
  assert.match(
    chatSource,
    /resolvedBoardSessionRef\.current = \{[\s\S]*?projectId,[\s\S]*?session: mappedSession/,
    "mapped session identity must survive React Query propagation"
  );
  assert.match(
    chatSource,
    /if \(resolved\?\.projectId === projectId\)[\s\S]*?return resolved\.session/,
    "a concurrent send must receive the exact session selected by setup"
  );
  assert.match(
    chatSource,
    /resolvedBoardSessionRef\.current = null;[\s\S]*?selectSessionInHistory\(sessionId\)/,
    "deliberate session selection must clear transient setup state"
  );
  assert.match(
    chatSource,
    /if \(!currentSessions\[0\]\)[\s\S]*?chatHistoryReadyRef\.current[\s\S]*?await createSession\(/,
    "successfully empty history must create the user's first session"
  );
  assert.match(commentSource, /chatHistoryReadyRef\.current/);
  assert.match(
    chatSource,
    /resolvedBoardSessionRef\.current\?\.session\.id === sessionId[\s\S]*?deleteSessionInHistory\(sessionId\)/,
    "deleting the transient session must invalidate the setup result"
  );
  assert.match(chatSource, /const sessionIntentGenerationRef = useRef\(0\)/);
  assert.match(
    chatSource,
    /setupContextRef\.current !== sessionContextKey[\s\S]*?sessionIntentGenerationRef\.current \+= 1[\s\S]*?previousProjectIdRef\.current = undefined/,
    "board navigation and chat scope changes must invalidate stale setup"
  );
  assert.match(
    chatSource,
    /const sessionContextKey = \[[\s\S]*?surface[\s\S]*?isFullScreenChat[\s\S]*?boardScopeIsExplicit[\s\S]*?scopedProjectId[\s\S]*?currentProject\?\.id[\s\S]*?currentUser\?\.id/,
    "the setup generation must cover the complete chat context"
  );
  assert.match(
    chatSource,
    /sessionsRef\.current\.filter\([\s\S]*?session\.userId === userId/,
    "session readiness must reject data owned by a previous account"
  );
  assert.match(
    chatSource,
    /const createdSession = await createSession[\s\S]*?if \(sessionIntentGenerationRef\.current !== generation\) return;[\s\S]*?setDockedChatScope\(null\)/,
    "an explicit scope reset must not invalidate its own new-session request"
  );
  assert.match(
    chatSource,
    /createSession\(isCurrentIntent\)[\s\S]*?if \(!isCurrentIntent\(\)\) return undefined/,
    "late session creation must not commit or route a stale result"
  );
  assert.match(
    historySource,
    /if \(!shouldCommit\(\)\) return;[\s\S]*?queryClient\.setQueryData/,
    "session creation must check intent before mutating the cache"
  );
  assert.match(
    historySource,
    /isSuccess: isDemo \? demoSessions\.length > 0 : isSuccessSessions/,
    "demo readiness must wait for its single local initialization path"
  );
});
