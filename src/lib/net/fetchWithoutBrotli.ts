import { Readable, pipeline } from "node:stream";
import zlib from "node:zlib";
import { request, type Dispatcher } from "undici";
import { contentEncodings, refusedContentEncoding, type DECODABLE_CONTENT_ENCODINGS } from "@/lib/net/contentEncoding";

export const UNTRUSTED_ACCEPT_ENCODING = "gzip, deflate";
const MAX_FOLLOWED_REDIRECTS = 5;
const DECODERS: Record<(typeof DECODABLE_CONTENT_ENCODINGS)[number], () => zlib.Gunzip | zlib.Inflate> = {
  gzip: () => zlib.createGunzip(),
  "x-gzip": () => zlib.createGunzip(),
  deflate: () => zlib.createInflate(),
};

export class RefusedContentEncodingError extends Error {
  constructor(encoding: string) {
    super(`Refused response with Content-Encoding "${encoding}"`);
    this.name = "RefusedContentEncodingError";
  }
}

export function assertDecodableContentEncoding(headerValue: string | null | undefined) {
  const refused = refusedContentEncoding(headerValue);
  if (refused) throw new RefusedContentEncodingError(refused);
}

type FetchWithoutBrotliInit = RequestInit & { dispatcher?: Dispatcher };

function requestBody(body: RequestInit["body"]): string | Uint8Array | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string" || body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (body instanceof URLSearchParams) return body.toString();
  throw new TypeError("fetchWithoutBrotli only sends string, byte or form-encoded bodies");
}

function responseHeaders(raw: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  return headers;
}

function decodedBody(body: Dispatcher.ResponseData["body"], encodings: string[]): ReadableStream<Uint8Array> {
  if (encodings.length === 0) return Readable.toWeb(body) as ReadableStream<Uint8Array>;
  const decoders = [...encodings].reverse().map((encoding) => DECODERS[encoding as keyof typeof DECODERS]());
  const decoded = pipeline([body, ...decoders] as unknown as [NodeJS.ReadableStream, NodeJS.WritableStream], () => undefined) as unknown as Readable;
  return Readable.toWeb(decoded) as ReadableStream<Uint8Array>;
}

const CREDENTIAL_HEADERS = ["authorization", "proxy-authorization", "cookie", "host"];

function isRedirect(status: number) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export async function fetchWithoutBrotli(input: string | URL | Request, init: FetchWithoutBrotliInit = {}): Promise<Response> {
  if (input instanceof Request) throw new TypeError("fetchWithoutBrotli takes a URL, not a Request");
  const headers = new Headers(init.headers);
  headers.set("accept-encoding", UNTRUSTED_ACCEPT_ENCODING);
  if (init.body instanceof URLSearchParams && !headers.has("content-type")) {
    headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
  } else if (typeof init.body === "string" && !headers.has("content-type")) {
    headers.set("content-type", "text/plain;charset=UTF-8");
  }
  let url = new URL(input.toString());
  let method = (init.method ?? "GET").toUpperCase();
  let body = requestBody(init.body);
  for (let redirects = 0; ; redirects += 1) {
    const response = await request(url, {
      method: method as Dispatcher.HttpMethod,
      headers: Object.fromEntries(headers),
      body,
      signal: init.signal ?? undefined,
      dispatcher: init.dispatcher,
    });
    const responseHeaderList = responseHeaders(response.headers);
    const location = responseHeaderList.get("location");
    if (isRedirect(response.statusCode) && location && init.redirect !== "manual") {
      await response.body.dump();
      if (init.redirect === "error" || redirects >= MAX_FOLLOWED_REDIRECTS) throw new Error("Too many redirects");
      const next = new URL(location, url);
      if (next.origin !== url.origin) CREDENTIAL_HEADERS.forEach((name) => headers.delete(name));
      url = next;
      if ((response.statusCode === 303 && method !== "HEAD") || ((response.statusCode === 301 || response.statusCode === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
        headers.delete("content-type");
      }
      continue;
    }
    const encodings = contentEncodings(responseHeaderList.get("content-encoding"));
    try {
      assertDecodableContentEncoding(responseHeaderList.get("content-encoding"));
    } catch (error) {
      response.body.destroy();
      throw error;
    }
    if (encodings.length > 0) {
      responseHeaderList.delete("content-encoding");
      responseHeaderList.delete("content-length");
    }
    const withoutBody = method === "HEAD" || response.statusCode === 204 || response.statusCode === 205 || response.statusCode === 304;
    if (withoutBody) await response.body.dump();
    const result = new Response(withoutBody ? null : decodedBody(response.body, encodings), {
      status: response.statusCode,
      headers: responseHeaderList,
    });
    Object.defineProperty(result, "url", { value: url.toString() });
    Object.defineProperty(result, "redirected", { value: redirects > 0 });
    return result;
  }
}
