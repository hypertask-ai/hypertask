import {
  aiModelOptions,
  getAiModelDefinition,
  type TAiModelKey,
} from "@/lib/aiModelOptions";
import {
  getAiProviderByByokKey,
  type TByokProviderKey,
} from "@/lib/aiProviders";
import {
  customEndpointChatCompletionsUrl,
  type CustomEndpointConfig,
} from "@/lib/ai/customEndpoint";

export type ByokTestResult = "works" | "invalid" | "no_credit" | "error";

const TEST_MODEL_KEYS: Partial<Record<TByokProviderKey, TAiModelKey>> = {
  openai: "gpt-5.4-mini",
  claude: "claude-haiku-4.5",
  google: "gemini-3.5-flash-lite",
  xai: "grok-4.1-fast",
  deepseek: "deepseek-v4-flash",
  moonshot: "kimi-k2.5",
  zhipu: "glm-5.2",
  alibaba: "qwen3.7-plus",
};

type TestRequest = {
  init: RequestInit;
  modelLabel: string;
  url: string;
};

function testModel(provider: TByokProviderKey) {
  const modelKey = TEST_MODEL_KEYS[provider];
  if (!modelKey) return null;
  const option = aiModelOptions.find(
    (candidate) => candidate.modelKey === modelKey
  );
  const definition = getAiModelDefinition(modelKey);
  if (!option || !definition) return null;

  const separator = option.model.indexOf("/");
  return {
    id:
      option.directModel ??
      (separator >= 0 ? option.model.slice(separator + 1) : option.model),
    label: definition.label,
  };
}

function jsonRequest(
  url: string,
  apiKey: string,
  model: { id: string; label: string },
  extraHeaders?: Record<string, string>,
  body?: Record<string, unknown>
): TestRequest {
  return {
    url,
    modelLabel: model.label,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      body: JSON.stringify(
        body ?? {
          model: model.id,
          messages: [{ role: "user", content: "Reply OK" }],
          max_tokens: 1,
        }
      ),
      cache: "no-store",
    },
  };
}

export function buildByokTestRequest(
  provider: TByokProviderKey,
  apiKey: string,
  customEndpoint?: Pick<CustomEndpointConfig, "baseUrl" | "modelId">
): TestRequest | null {
  if (provider === "custom") {
    if (!customEndpoint) return null;
    return jsonRequest(
      customEndpointChatCompletionsUrl(customEndpoint.baseUrl),
      apiKey,
      { id: customEndpoint.modelId, label: customEndpoint.modelId }
    );
  }

  if (provider === "gateway") {
    return jsonRequest(
      "https://ai-gateway.vercel.sh/v1/chat/completions",
      apiKey,
      { id: "openai/gpt-5.4-mini", label: "GPT-5.4 Mini" }
    );
  }

  if (provider === "openrouter") {
    return jsonRequest(
      "https://openrouter.ai/api/v1/chat/completions",
      apiKey,
      { id: "openai/gpt-5.4-mini", label: "GPT-5.4 Mini" }
    );
  }

  const model = testModel(provider);
  if (!model) return null;

  if (provider === "openai") {
    return jsonRequest(
      "https://api.openai.com/v1/chat/completions",
      apiKey,
      model,
      undefined,
      {
        model: model.id,
        messages: [{ role: "user", content: "Reply OK" }],
        max_completion_tokens: 1,
      }
    );
  }

  if (provider === "claude") {
    return {
      url: "https://api.anthropic.com/v1/messages",
      modelLabel: model.label,
      init: {
        method: "POST",
        headers: {
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          model: model.id,
          messages: [{ role: "user", content: "Reply OK" }],
          max_tokens: 1,
        }),
        cache: "no-store",
      },
    };
  }

  const providerInfo = getAiProviderByByokKey(provider);
  if (!providerInfo?.openAiCompatibleBaseUrl) return null;
  return jsonRequest(
    `${providerInfo.openAiCompatibleBaseUrl}/chat/completions`,
    apiKey,
    model
  );
}

const NO_CREDIT_PATTERN =
  /(insufficient|exhausted|exceeded|no).{0,30}(credit|credits|balance|quota)|billing|payment required/i;

export function classifyByokTestResponse(
  status: number,
  responseBody: string
): ByokTestResult {
  if (status >= 200 && status < 300) return "works";
  if (status === 401) return "invalid";
  if (status === 402 || NO_CREDIT_PATTERN.test(responseBody)) {
    return "no_credit";
  }
  return "error";
}
