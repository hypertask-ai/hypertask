export const FULL_SCREEN_CHAT_RETURN_PARAM = "return_to";
export const FULL_SCREEN_CHAT_FALLBACK_PATH = "/project";

const isSafeAppPath = (path: string | null | undefined): path is string =>
  Boolean(
    path &&
      path.startsWith("/") &&
      !path.startsWith("//") &&
      !path.includes("\\") &&
      !/[\u0000-\u001f\u007f]/.test(path) &&
      !/^\/chat(?:[/?#]|$)/.test(path)
  );

export const buildFullScreenChatPath = (
  returnPath: string,
  sessionId?: string
) => {
  const chatPath = sessionId ? `/chat/${sessionId}` : "/chat";
  return isSafeAppPath(returnPath)
    ? `${chatPath}?${FULL_SCREEN_CHAT_RETURN_PARAM}=${encodeURIComponent(returnPath)}`
    : chatPath;
};

export const resolveFullScreenChatReturnPath = (
  returnPath: string | null | undefined
) =>
  isSafeAppPath(returnPath) ? returnPath : FULL_SCREEN_CHAT_FALLBACK_PATH;
