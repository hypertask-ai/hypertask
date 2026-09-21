import type { NextApiRequest, NextApiResponse } from "next";

import { getSessionUser, type SessionUser } from "#session-user";
import { apiError } from "#api-response";

type RequestWithHeaders = Request | NextApiRequest | Headers;
type RouteHandler = (...args: any[]) => any;

const authenticatedRequests = new WeakMap<object, SessionUser>();

function requestHeaders(source: RequestWithHeaders): Headers {
  if (source instanceof Headers) return source;
  if (source.headers instanceof Headers) return source.headers;

  const headers = new Headers();
  for (const [name, value] of Object.entries(source.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(", "));
  }
  return headers;
}

export async function getAuthSession(
  source: RequestWithHeaders,
): Promise<SessionUser | null> {
  if (!(source instanceof Headers)) {
    const cached = authenticatedRequests.get(source);
    if (cached) return cached;
  }
  return getSessionUser(requestHeaders(source));
}

function isPagesRequest(value: RequestWithHeaders): value is NextApiRequest {
  return !(value instanceof Headers) && !(value.headers instanceof Headers);
}

export function withAuth<THandler extends RouteHandler>(
  handler: THandler,
  options: { authenticateInHandler?: boolean } = {},
): THandler {
  // Existing routes keep their authorization and test seams while the proxy
  // supplies the shared missing-session gate. New routes use the wrapper check.
  if (options.authenticateInHandler) return handler;

  const authenticated = async (...args: Parameters<THandler>) => {
    const request = args[0] as RequestWithHeaders;
    const session = await getSessionUser(requestHeaders(request));
    if (!session) {
      if (isPagesRequest(request)) {
        return apiError(401, "Unauthorized", args[1] as NextApiResponse);
      }
      return apiError(401, "Unauthorized");
    }

    authenticatedRequests.set(request, session);
    return handler(...args);
  };

  return authenticated as THandler;
}

// Public routes must opt out explicitly so the route-export lint rule can tell
// an intentional exception from a forgotten auth wrapper.
export function withoutAuth<THandler extends RouteHandler>(handler: THandler): THandler {
  return handler;
}
