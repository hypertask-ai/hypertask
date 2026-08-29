/**
 * HTTP Status Code Configuration
 * Based on RFC 9110 and MDN Web Docs
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status
 */

export type HttpStatusCategory =
  | "informational"
  | "success"
  | "redirection"
  | "client_error"
  | "server_error";

export type HttpStatusCode =
  // Informational (1xx)
  | 100
  | 101
  | 102
  | 103
  // Success (2xx)
  | 200
  | 201
  | 202
  | 203
  | 204
  | 205
  | 206
  | 207
  | 208
  | 226
  // Redirection (3xx)
  | 300
  | 301
  | 302
  | 303
  | 304
  | 307
  | 308
  // Client Error (4xx)
  | 400
  | 401
  | 402
  | 403
  | 404
  | 405
  | 406
  | 407
  | 408
  | 409
  | 410
  | 411
  | 412
  | 413
  | 414
  | 415
  | 416
  | 417
  | 418
  | 421
  | 422
  | 423
  | 424
  | 425
  | 426
  | 428
  | 429
  | 431
  | 451
  // Server Error (5xx)
  | 500
  | 501
  | 502
  | 503
  | 504
  | 505
  | 506
  | 507
  | 508
  | 510
  | 511;

export interface StatusCodeInfo {
  code: HttpStatusCode;
  name: string;
  category: HttpStatusCategory;
  description: string;
  userMessage?: string;
  retryable?: boolean;
  deprecated?: boolean;
}

type PartialHttpStatusConfig = {
  informational?: HttpStatusCode[];
  success?: HttpStatusCode[];
  redirection?: HttpStatusCode[];
  clientError?: HttpStatusCode[];
  serverError?: HttpStatusCode[];
};

export const httpStatusConfig = {
  // Category definitions
  informational: [100, 101, 102, 103] as HttpStatusCode[],
  success: [
    200, 201, 202, 203, 204, 205, 206, 207, 208, 226,
  ] as HttpStatusCode[],
  redirection: [300, 301, 302, 303, 304, 307, 308] as HttpStatusCode[],
  clientError: [
    400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414,
    415, 416, 417, 418, 421, 422, 423, 424, 425, 426, 428, 429, 431, 451,
  ] as HttpStatusCode[],
  serverError: [
    500, 501, 502, 503, 504, 505, 506, 507, 508, 510, 511,
  ] as HttpStatusCode[],

  // Retryable status codes
  retryable: [408, 429, 500, 502, 503, 504] as HttpStatusCode[],

  // Deprecated status codes
  deprecated: [102, 305, 306] as HttpStatusCode[],

  // Status code details
  statusCodes: {
    // Informational responses (1xx)
    100: {
      code: 100,
      name: "Continue",
      category: "informational",
      description:
        "The client should continue the request or ignore if already finished.",
      userMessage: "Request is being processed...",
    },
    101: {
      code: 101,
      name: "Switching Protocols",
      category: "informational",
      description:
        "The server is switching protocols as requested by the client.",
      userMessage: "Switching protocols...",
    },
    102: {
      code: 102,
      name: "Processing",
      category: "informational",
      description:
        "The server has received and is processing the request (WebDAV).",
      userMessage: "Processing your request...",
      deprecated: true,
    },
    103: {
      code: 103,
      name: "Early Hints",
      category: "informational",
      description:
        "Used with the Link header to preload resources while the server prepares a response.",
      userMessage: "Preparing response...",
    },

    // Successful responses (2xx)
    200: {
      code: 200,
      name: "OK",
      category: "success",
      description: "The request succeeded.",
      userMessage: "Success!",
    },
    201: {
      code: 201,
      name: "Created",
      category: "success",
      description: "The request succeeded and a new resource was created.",
      userMessage: "Created successfully!",
    },
    202: {
      code: 202,
      name: "Accepted",
      category: "success",
      description: "The request has been received but not yet acted upon.",
      userMessage: "Request accepted for processing.",
    },
    203: {
      code: 203,
      name: "Non-Authoritative Information",
      category: "success",
      description: "The returned metadata is from a local or third-party copy.",
      userMessage: "Success (cached information).",
    },
    204: {
      code: 204,
      name: "No Content",
      category: "success",
      description: "There is no content to send for this request.",
      userMessage: "Success (no content).",
    },
    205: {
      code: 205,
      name: "Reset Content",
      category: "success",
      description: "Tells the user agent to reset the document.",
      userMessage: "Please reset the form.",
    },
    206: {
      code: 206,
      name: "Partial Content",
      category: "success",
      description: "Response to a range request for part of a resource.",
      userMessage: "Partial content loaded.",
    },
    207: {
      code: 207,
      name: "Multi-Status",
      category: "success",
      description: "Conveys information about multiple resources (WebDAV).",
      userMessage: "Multiple operations completed.",
    },
    208: {
      code: 208,
      name: "Already Reported",
      category: "success",
      description: "Members already enumerated (WebDAV).",
      userMessage: "Already reported.",
    },
    226: {
      code: 226,
      name: "IM Used",
      category: "success",
      description:
        "The server has fulfilled a GET request for the resource (HTTP Delta encoding).",
      userMessage: "Success with transformations.",
    },

    // Redirection messages (3xx)
    300: {
      code: 300,
      name: "Multiple Choices",
      category: "redirection",
      description: "The request has more than one possible response.",
      userMessage: "Multiple options available.",
    },
    301: {
      code: 301,
      name: "Moved Permanently",
      category: "redirection",
      description:
        "The URL of the requested resource has been changed permanently.",
      userMessage: "Resource has moved permanently.",
    },
    302: {
      code: 302,
      name: "Found",
      category: "redirection",
      description: "The URI has been changed temporarily.",
      userMessage: "Resource temporarily moved.",
    },
    303: {
      code: 303,
      name: "See Other",
      category: "redirection",
      description:
        "Get the requested resource at another URI with a GET request.",
      userMessage: "Redirecting to another resource.",
    },
    304: {
      code: 304,
      name: "Not Modified",
      category: "redirection",
      description: "The response has not been modified, use cached version.",
      userMessage: "Content not modified.",
    },
    305: {
      code: 305,
      name: "Use Proxy",
      category: "redirection",
      description: "Requested response must be accessed by a proxy.",
      userMessage: "Please use proxy.",
      deprecated: true,
    },
    307: {
      code: 307,
      name: "Temporary Redirect",
      category: "redirection",
      description:
        "Get the requested resource at another URI with the same method.",
      userMessage: "Temporarily redirecting...",
    },
    308: {
      code: 308,
      name: "Permanent Redirect",
      category: "redirection",
      description: "The resource is permanently located at another URI.",
      userMessage: "Permanently redirecting...",
    },

    // Client error responses (4xx)
    400: {
      code: 400,
      name: "Bad Request",
      category: "client_error",
      description: "The server cannot process the request due to client error.",
      userMessage: "Invalid request. Please check your input.",
      retryable: false,
    },
    401: {
      code: 401,
      name: "Unauthorized",
      category: "client_error",
      description:
        "Authentication is required and has failed or not been provided.",
      userMessage: "Authentication required. Please sign in.",
      retryable: false,
    },
    402: {
      code: 402,
      name: "Payment Required",
      category: "client_error",
      description:
        "Reserved for future use (originally for digital payment systems).",
      userMessage: "Payment required.",
      retryable: false,
    },
    403: {
      code: 403,
      name: "Forbidden",
      category: "client_error",
      description: "The client does not have access rights to the content.",
      userMessage: "Access denied. You don't have permission.",
      retryable: false,
    },
    404: {
      code: 404,
      name: "Not Found",
      category: "client_error",
      description: "The server cannot find the requested resource.",
      userMessage: "Resource not found.",
      retryable: false,
    },
    405: {
      code: 405,
      name: "Method Not Allowed",
      category: "client_error",
      description: "The request method is not supported for this resource.",
      userMessage: "Method not allowed.",
      retryable: false,
    },
    406: {
      code: 406,
      name: "Not Acceptable",
      category: "client_error",
      description:
        "The server cannot produce a response matching the accept headers.",
      userMessage: "Not acceptable format.",
      retryable: false,
    },
    407: {
      code: 407,
      name: "Proxy Authentication Required",
      category: "client_error",
      description: "Authentication with the proxy is required.",
      userMessage: "Proxy authentication required.",
      retryable: false,
    },
    408: {
      code: 408,
      name: "Request Timeout",
      category: "client_error",
      description: "The server timed out waiting for the request.",
      userMessage: "Request timed out. Please try again.",
      retryable: true,
    },
    409: {
      code: 409,
      name: "Conflict",
      category: "client_error",
      description: "Request conflicts with the current state of the server.",
      userMessage: "Conflict with existing data.",
      retryable: false,
    },
    410: {
      code: 410,
      name: "Gone",
      category: "client_error",
      description: "The requested content has been permanently deleted.",
      userMessage: "Resource no longer available.",
      retryable: false,
    },
    411: {
      code: 411,
      name: "Length Required",
      category: "client_error",
      description: "Content-Length header is required.",
      userMessage: "Content length required.",
      retryable: false,
    },
    412: {
      code: 412,
      name: "Precondition Failed",
      category: "client_error",
      description: "Preconditions in the headers were not met.",
      userMessage: "Precondition failed.",
      retryable: false,
    },
    413: {
      code: 413,
      name: "Content Too Large",
      category: "client_error",
      description: "Request entity is larger than server limits.",
      userMessage: "File or data too large.",
      retryable: false,
    },
    414: {
      code: 414,
      name: "URI Too Long",
      category: "client_error",
      description: "The URI is too long for the server to process.",
      userMessage: "URL too long.",
      retryable: false,
    },
    415: {
      code: 415,
      name: "Unsupported Media Type",
      category: "client_error",
      description: "The media format is not supported.",
      userMessage: "Unsupported file format.",
      retryable: false,
    },
    416: {
      code: 416,
      name: "Range Not Satisfiable",
      category: "client_error",
      description:
        "The range specified in the Range header cannot be fulfilled.",
      userMessage: "Requested range not available.",
      retryable: false,
    },
    417: {
      code: 417,
      name: "Expectation Failed",
      category: "client_error",
      description: "The expectation in the Expect header cannot be met.",
      userMessage: "Expectation failed.",
      retryable: false,
    },
    418: {
      code: 418,
      name: "I'm a teapot",
      category: "client_error",
      description:
        "The server refuses to brew coffee because it is a teapot (April Fools' joke).",
      userMessage: "I'm a teapot ☕",
      retryable: false,
    },
    421: {
      code: 421,
      name: "Misdirected Request",
      category: "client_error",
      description:
        "The request was directed at a server unable to produce a response.",
      userMessage: "Request misdirected.",
      retryable: false,
    },
    422: {
      code: 422,
      name: "Unprocessable Content",
      category: "client_error",
      description: "The request was well-formed but contains semantic errors.",
      userMessage: "Unable to process the content.",
      retryable: false,
    },
    423: {
      code: 423,
      name: "Locked",
      category: "client_error",
      description: "The resource is locked (WebDAV).",
      userMessage: "Resource is locked.",
      retryable: false,
    },
    424: {
      code: 424,
      name: "Failed Dependency",
      category: "client_error",
      description:
        "The request failed due to failure of a previous request (WebDAV).",
      userMessage: "Failed dependency.",
      retryable: false,
    },
    425: {
      code: 425,
      name: "Too Early",
      category: "client_error",
      description:
        "The server is unwilling to risk processing a request that might be replayed.",
      userMessage: "Request too early.",
      retryable: true,
    },
    426: {
      code: 426,
      name: "Upgrade Required",
      category: "client_error",
      description: "The client should switch to a different protocol.",
      userMessage: "Protocol upgrade required.",
      retryable: false,
    },
    428: {
      code: 428,
      name: "Precondition Required",
      category: "client_error",
      description: "The server requires the request to be conditional.",
      userMessage: "Precondition required.",
      retryable: false,
    },
    429: {
      code: 429,
      name: "Too Many Requests",
      category: "client_error",
      description:
        "The user has sent too many requests in a given time (rate limiting).",
      userMessage: "Too many requests. Please slow down.",
      retryable: true,
    },
    431: {
      code: 431,
      name: "Request Header Fields Too Large",
      category: "client_error",
      description: "The request header fields are too large.",
      userMessage: "Request headers too large.",
      retryable: false,
    },
    451: {
      code: 451,
      name: "Unavailable For Legal Reasons",
      category: "client_error",
      description: "The resource is unavailable due to legal reasons.",
      userMessage: "Unavailable for legal reasons.",
      retryable: false,
    },

    // Server error responses (5xx)
    500: {
      code: 500,
      name: "Internal Server Error",
      category: "server_error",
      description: "The server encountered an unexpected condition.",
      userMessage: "Something went wrong on our end. Please try again.",
      retryable: true,
    },
    501: {
      code: 501,
      name: "Not Implemented",
      category: "server_error",
      description: "The request method is not supported by the server.",
      userMessage: "Feature not implemented.",
      retryable: false,
    },
    502: {
      code: 502,
      name: "Bad Gateway",
      category: "server_error",
      description:
        "The server received an invalid response from the upstream server.",
      userMessage: "Bad gateway. Please try again.",
      retryable: true,
    },
    503: {
      code: 503,
      name: "Service Unavailable",
      category: "server_error",
      description:
        "The server is not ready to handle the request (maintenance or overloaded).",
      userMessage: "Service temporarily unavailable. Please try again later.",
      retryable: true,
    },
    504: {
      code: 504,
      name: "Gateway Timeout",
      category: "server_error",
      description:
        "The server did not receive a timely response from upstream server.",
      userMessage: "Gateway timeout. Please try again.",
      retryable: true,
    },
    505: {
      code: 505,
      name: "HTTP Version Not Supported",
      category: "server_error",
      description: "The HTTP version used in the request is not supported.",
      userMessage: "HTTP version not supported.",
      retryable: false,
    },
    506: {
      code: 506,
      name: "Variant Also Negotiates",
      category: "server_error",
      description:
        "Internal server configuration error in content negotiation.",
      userMessage: "Server configuration error.",
      retryable: false,
    },
    507: {
      code: 507,
      name: "Insufficient Storage",
      category: "server_error",
      description: "The server is unable to store the representation (WebDAV).",
      userMessage: "Insufficient storage space.",
      retryable: false,
    },
    508: {
      code: 508,
      name: "Loop Detected",
      category: "server_error",
      description:
        "The server detected an infinite loop while processing (WebDAV).",
      userMessage: "Loop detected in request.",
      retryable: false,
    },
    510: {
      code: 510,
      name: "Not Extended",
      category: "server_error",
      description: "Further extensions to the request are required.",
      userMessage: "Extensions required.",
      retryable: false,
    },
    511: {
      code: 511,
      name: "Network Authentication Required",
      category: "server_error",
      description: "The client needs to authenticate to gain network access.",
      userMessage: "Network authentication required.",
      retryable: false,
    },
  } as Record<HttpStatusCode, StatusCodeInfo>,
} satisfies PartialHttpStatusConfig & Record<string, unknown>;

// Type exports
export type HttpStatusConfig = typeof httpStatusConfig;
