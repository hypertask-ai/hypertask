type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function boundedString(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim()
    ? value.slice(0, maxLength)
    : undefined;
}

function requestPath(value: unknown) {
  const url = boundedString(value, 2048);
  if (!url) return undefined;

  try {
    return new URL(url, "https://client.invalid").pathname.slice(0, 1000);
  } catch {
    return url.split(/[?#]/, 1)[0].slice(0, 1000);
  }
}

export function axiosErrorDiagnostics(reason: unknown) {
  const error = record(reason);
  if (!error || (error.isAxiosError !== true && error.name !== "AxiosError")) {
    return {};
  }

  const config = record(error.config);
  const response = record(error.response);
  const responseData = record(response?.data);
  const diagnostics: Record<string, string | number | boolean | null> = {};

  const code = boundedString(error.code, 80);
  if (code) diagnostics.axiosCode = code;

  const method = boundedString(config?.method, 20);
  if (method) diagnostics.requestMethod = method.toUpperCase();

  const path = requestPath(config?.url);
  if (path) diagnostics.requestPath = path;

  if (typeof response?.status === "number") {
    diagnostics.responseStatus = response.status;
  }
  const statusText = boundedString(response?.statusText, 200);
  if (statusText) diagnostics.responseStatusText = statusText;

  const responseMessage =
    boundedString(responseData?.message, 500) ||
    boundedString(responseData?.error, 500);
  if (responseMessage) diagnostics.responseMessage = responseMessage;

  return diagnostics;
}
