export type CustomEndpointConfig = {
  apiKey: string;
  baseUrl: string;
  gdprCompliant?: boolean;
  modelId: string;
};

type StoredCustomEndpointConfig = CustomEndpointConfig & {
  kind: "openai-compatible";
  version: 1;
};

const MAX_API_KEY_LENGTH = 20_000;
const MAX_BASE_URL_LENGTH = 2_048;
const MAX_MODEL_ID_LENGTH = 256;

function isPrivateIpv4(hostname: string) {
  const octets = hostname.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some(
      (octet, index) =>
        !Number.isInteger(octet) ||
        octet < 0 ||
        octet > 255 ||
        String(octet) !== hostname.split(".")[index]
    )
  ) {
    return false;
  }

  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function isPrivateHost(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    isPrivateIpv4(normalized)
  );
}

export function normalizeCustomEndpointBaseUrl(value: unknown) {
  const input = typeof value === "string" ? value.trim() : "";
  if (!input || input.length > MAX_BASE_URL_LENGTH) {
    throw new Error("A valid base URL is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error("A valid base URL is required");
  }

  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    isPrivateHost(parsed.hostname)
  ) {
    throw new Error("Base URL must use a public HTTP(S) host");
  }

  return parsed.toString().replace(/\/+$/, "");
}

export function normalizeCustomEndpointModelId(value: unknown) {
  const modelId = typeof value === "string" ? value.trim() : "";
  if (!modelId || modelId.length > MAX_MODEL_ID_LENGTH) {
    throw new Error("A valid model ID is required");
  }
  return modelId;
}

export function normalizeCustomEndpointApiKey(value: unknown) {
  const apiKey = typeof value === "string" ? value.trim() : "";
  if (!apiKey || apiKey.length > MAX_API_KEY_LENGTH) {
    throw new Error("A valid API key is required");
  }
  return apiKey;
}

export function normalizeCustomEndpointConfig(
  value: Partial<CustomEndpointConfig>
): CustomEndpointConfig {
  return {
    apiKey: normalizeCustomEndpointApiKey(value.apiKey),
    baseUrl: normalizeCustomEndpointBaseUrl(value.baseUrl),
    gdprCompliant: value.gdprCompliant === true,
    modelId: normalizeCustomEndpointModelId(value.modelId),
  };
}

export function serializeCustomEndpointConfig(config: CustomEndpointConfig) {
  const normalized = normalizeCustomEndpointConfig(config);
  return JSON.stringify({
    kind: "openai-compatible",
    version: 1,
    ...normalized,
  } satisfies StoredCustomEndpointConfig);
}

export function parseCustomEndpointConfig(
  decryptedPayload: string
): CustomEndpointConfig | null {
  try {
    const value = JSON.parse(
      decryptedPayload
    ) as Partial<StoredCustomEndpointConfig>;
    if (value.kind !== "openai-compatible" || value.version !== 1) return null;
    return normalizeCustomEndpointConfig(value);
  } catch {
    return null;
  }
}

export function isCustomEndpointConfig(
  value: unknown
): value is CustomEndpointConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<CustomEndpointConfig>;
  return (
    typeof candidate.apiKey === "string" &&
    typeof candidate.baseUrl === "string" &&
    (candidate.gdprCompliant === undefined ||
      typeof candidate.gdprCompliant === "boolean") &&
    typeof candidate.modelId === "string"
  );
}

export function customEndpointChatCompletionsUrl(baseUrl: string) {
  return `${normalizeCustomEndpointBaseUrl(baseUrl)}/chat/completions`;
}
