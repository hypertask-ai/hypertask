import type { NextApiRequest, NextApiResponse } from "next";

import { getSessionUser, type SessionUser } from "#session-user";
import { apiError } from "#api-response";

type RequestWithHeaders = Request | NextApiRequest | Headers;
type RequestLike = RequestWithHeaders | null | undefined;
type RouteHandler = (...args: any[]) => any;

const authenticatedRequests = new WeakMap<object, SessionUser>();

function requestHeaders(source: RequestLike): Headers {
  if (source instanceof Headers) return source;
  if (source?.headers instanceof Headers) return source.headers;

  const headers = new Headers();
  for (const [name, value] of Object.entries(source?.headers ?? {})) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(", "));
  }
  return headers;
}

export async function getAuthSession(
  source: RequestWithHeaders,
): Promise<SessionUser | null> {
  const cached = authenticatedRequests.get(source);
  if (cached) return cached;
  return getSessionUser(requestHeaders(source));
}

function isPagesRequest(value: RequestLike): value is NextApiRequest {
  return !(value instanceof Headers) && !(value?.headers instanceof Headers);
}

export function withAuth<THandler extends RouteHandler>(handler: THandler): THandler {
  const authenticated = async (...args: Parameters<THandler>) => {
    const request = args[0] as RequestLike;
    const headers = requestHeaders(request);
    const session = await getSessionUser(headers);
    if (!session) {
      if (isPagesRequest(request)) {
        return apiError(401, "Unauthorized", args[1] as NextApiResponse);
      }
      return apiError(401, "Unauthorized");
    }

    if (request && typeof request === "object") {
      authenticatedRequests.set(request, session);
      if (!(request instanceof Headers) && request.headers && typeof request.headers === "object") {
        authenticatedRequests.set(request.headers, session);
      }
    }
    authenticatedRequests.set(headers, session);
    return handler(...args);
  };

  return authenticated as THandler;
}

// Public routes must opt out explicitly so the route-export lint rule can tell
// an intentional exception from a forgotten auth wrapper.
export function withoutAuth<THandler extends RouteHandler>(handler: THandler): THandler {
  return handler;
}
