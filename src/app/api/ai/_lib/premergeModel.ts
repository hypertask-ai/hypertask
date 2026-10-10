import { createHash } from "node:crypto";
import type { LanguageModelV4, LanguageModelV4CallOptions } from "@ai-sdk/provider";
import type { JSONSchema7, JSONSchema7Definition } from "json-schema";
import { premergeStubEnabled } from "@/lib/premergeStubs";

const headings = {
  english: ["Summary", "Acceptance criteria", "Due date"],
  french: ["Résumé", "Critères d'acceptation", "Date limite"],
  german: ["Zusammenfassung", "Akzeptanzkriterien", "Fälligkeitsdatum"],
  spanish: ["Resumen", "Criterios de aceptación", "Fecha límite"],
  dutch: ["Samenvatting", "Acceptatiecriteria", "Uiterste datum"],
  japanese: ["概要", "受け入れ条件", "期限"],
  chinese: ["摘要", "验收标准", "截止日期"],
};

function schemaFixture(schema: JSONSchema7Definition): unknown {
  if (typeof schema === "boolean") {
    if (!schema) throw new Error("Unsupported premerge JSON schema");
    return "Local premerge fixture";
  }
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.anyOf || schema.oneOf) return schemaFixture((schema.anyOf ?? schema.oneOf)![0]);
  switch (schema.type) {
    case "object": return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, value]) => [key, schemaFixture(value)]));
    case "array": return Array.from({ length: schema.minItems ?? 1 }, () => schemaFixture(schema.items as JSONSchema7Definition ?? true));
    case "boolean": return false;
    case "null": return null;
    case "number": case "integer": return schema.minimum ?? 0;
    case "string": return "Local premerge fixture";
    default: throw new Error("Unsupported premerge JSON schema");
  }
}

function responseText(params: LanguageModelV4CallOptions, modelId: string): string {
  if (!premergeStubEnabled("ai")) throw new Error("Premerge AI stub is no longer enabled");
  params.abortSignal?.throwIfAborted();
  const system = params.prompt.filter((message) => message.role === "system").map((message) => message.content).join("\n");
  console.info("[premerge-ai]", JSON.stringify({ modelId, systemPromptSha256: createHash("sha256").update(system).digest("hex") }));
  if (params.responseFormat?.type === "json") {
    return JSON.stringify(schemaFixture(params.responseFormat.schema ?? { type: "object" } as JSONSchema7));
  }
  const prompt = params.prompt.filter((message) => message.role === "user")
    .flatMap((message) => message.content.filter((part) => part.type === "text").map((part) => part.text)).join("\n");
  const language = prompt.match(/\b(?:in|language\s*[:=])\s*(english|french|german|spanish|dutch|japanese|chinese)\b/i)?.[1].toLowerCase() as keyof typeof headings | undefined;
  const [summary, acceptance, dueHeading] = headings[language ?? "english"];
  const due = prompt.match(/\bdue\s+(\d{4}-\d{2}-\d{2})\b/i)?.[1];
  return `<h1 id="ai-generated-task-title">Review onboarding</h1><h2>${summary}</h2><p>Review the onboarding flow and record the next steps.</p><h2>${acceptance}</h2><ul><li>The onboarding review is documented.</li></ul>` +
    (due ? `<h2>${dueHeading}</h2><p>${due}</p><span id="ai-generated-task-due-date" style="display:none">${due}</span>` : "");
}

export function createPremergeLanguageModel(modelId: string): LanguageModelV4 | undefined {
  if (!premergeStubEnabled("ai")) return undefined;
  const usage = {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
  };
  const finishReason = { unified: "stop" as const, raw: "stop" };
  return {
    specificationVersion: "v4",
    provider: "premerge-stub",
    modelId,
    supportedUrls: {},
    async doGenerate(params) {
      return { content: [{ type: "text", text: responseText(params, modelId) }], usage, finishReason, warnings: [] };
    },
    async doStream(params) {
      const text = responseText(params, modelId);
      return { stream: new ReadableStream({ start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "premerge" });
        controller.enqueue({ type: "text-delta", id: "premerge", delta: text });
        controller.enqueue({ type: "text-end", id: "premerge" });
        controller.enqueue({ type: "finish", usage, finishReason });
        controller.close();
      } }) };
    },
  };
}
