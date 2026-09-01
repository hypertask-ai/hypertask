import { cookies } from "next/headers";
import {
  I_HAVE_ADHD_SKILL,
  STRUCTURED_WRITING_STYLE,
  UNSLOP_SKILL,
} from "@/app/api/ai/_lib/writingSkills";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import {
  wrapLanguageModel,
  type FilePart,
  type LanguageModel,
  type LanguageModelMiddleware,
  type ToolSet,
  type UserContent,
} from "ai";
import {
  searchComments,
  searchTasks,
  type TurbopufferCommentRow,
  type TurbopufferTaskRow,
} from "@/utils/controllers/turbopuffer/turbopufferHelper";
import { retrieveCustomInstructionFileContext } from "@/app/api/ai/_lib/customInstructions";
import { logAiUsage } from "@/app/api/ai/_lib/aiUsage";
import {
  getByokOrTeamGatewayApiKeyForProvider,
  getByokOrTeamGatewayApiKeyForModelOption,
  getTeamGatewayApiKey,
  type ByokProviderFlag,
} from "@/app/api/ai/_lib/byokKeys";
import { sharedAiAllowanceErrorMessage } from "@/app/api/ai/_lib/sharedAllowance";
import {
  filterModelOptionForTeam,
  getProjectTeamProviderContext,
} from "@/app/api/ai/_lib/providerGate";
import {
  aiUsageProviderForCredential,
  isCustomEndpointConfig,
  isVercelAiGatewayKey,
  providerOptionsForAiModel,
  resolveAiModel,
  type AiModelCredential,
  type AiGatewayTags,
  type AiProviderOptions,
  type AiGatewayFeature,
} from "@/app/api/ai/_lib/modelProvider";
import {
  defaultAiModelOption,
  getDefaultAiModelOptionForPlan,
  getAiModelOptionById,
  preferredAiModelOption,
  type TAiModelOption,
} from "@/lib/aiModelOptions";
import {
  resolveUserFacingModelOption,
  type UserFacingModelFeature,
} from "@/lib/systemModelLadder";
import {
  getAiModelPreferenceIds,
  type TAiModelPreferenceSurface,
  type TAiModelPreferences,
} from "@/lib/aiModelPreferences";
import {
  assertModelAllowedForPlan,
  storePlanIdForProject,
} from "@/app/api/ai/_lib/planGate";
import {
  createTaskWriterSystemPromptTemplate,
  excludeLoadedTaskRows,
  wrapTaskWriterContext,
} from "@/app/api/ai/_lib/taskWriterPrompt";
import {
  createBoardTemplatesBlock,
  type BoardTemplateContext,
} from "@/app/api/ai/_lib/boardTemplateContext";
import prisma from "@/lib/prisma";

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export type ProviderId =
  "claude" | "openai" | "openrouter" | "gateway" | "custom";

export type CookieUser = {
  id?: number;
  email?: string;
  displayName?: string;
};

export type TaskWriterFile = {
  fileName?: string | null;
  url?: string | null;
  base64?: string | null;
  data?: string | null;
  mimeType?: string | null;
  type?: string | null;
};

export type SelectedModel = {
  provider: ProviderId;
  usageProvider: string;
  modelId: string;
  model: LanguageModel;
  providerOptions?: AiProviderOptions;
  settings: {
    temperature?: number;
    maxOutputTokens?: number;
  };
  tools?: ToolSet;
};

const DEFAULT_PROVIDER: ProviderId = "openai";
const DEFAULT_MODEL = "gpt-5.6-luna";
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5";
const CLAUDE_MODELS = new Set([
  "claude-sonnet-5",
  "claude-opus-5",
  "claude-haiku-4.5",
]);
const OPENAI_MODELS = new Set([
  "gpt-5.5",
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-5.6-sol",
  "gpt-5.4-mini",
]);

const CLAUDE_TEMPERATURE_UNSUPPORTED_PREFIXES = [
  "claude-opus",
  "claude-sonnet-5",
] as const;

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const IMG_SRC_RE = /src\s*=\s*["']([^"']+)["']/i;
const CODE_FENCE_OPEN_RE = /^\s*```[a-zA-Z0-9]*[ \t]*\r?\n?/;
const CODE_FENCE_CLOSE_RE = /\r?\n?[ \t]*```\s*$/;

export const NVC_STYLE_RULE = `- Nonviolent communication: neutral, non-blaming phrasing (observations + needs, no accusations). ONLY exception: if the user's own text or request explicitly insists on harsh/blunt language, preserve their tone - never sanitize against their will.`;

export const HOUSE_OUTPUT_STYLE = `- Bottom line up front: first sentence states the outcome/ask (pyramid principle).
- Short and scannable: 1-2 sentence paragraphs, bullets for anything multi-part, sentences <= 20 words where possible.
- Bold the load-bearing content (key terms, actions, decisions), never labels like "Issue:".
- Roughly half the word count a first draft would use.
${NVC_STYLE_RULE}
- No hashtags, no markdown asterisks in HTML surfaces.
- Never output an em dash; use a period, comma, or colon.
- No chatbot phrases: never open with "Great question", "Sure!", "Certainly", "Let me..."; never close with "I hope this helps", "Let me know if...", "Feel free to...".
- Banned words (use the plain alternative): delve, pivotal, crucial, robust, seamless(ly), leverage/utilize (use "use"), showcase, testament, landscape, tapestry, vibrant, comprehensive, streamline, facilitate (use "help"), enhance (use "improve"), additionally (use "also"), "it's important to note", "serves as"/"boasts" (use "is"/"has").
- No "not just X, but Y" framing; state the point directly.
- Cut hedging stacks ("could potentially possibly"); one hedge maximum where uncertainty is real.`;

// HTPR-5606: the authoring style for the AI Task Writer and Write with AI.
// Same two skill files as the Improve button, verbatim, plus the two rules
// that only matter when the model AUTHORS rather than rewrites: it must not
// write content the brief never gave it, and it must not drop content the
// brief did give it. A demo run on INNE-1576 invented 95 words of German and
// English subheadlines the source never contained; that is what these stop.
export const TASK_AUTHORING_STYLE = `- Apply the following two skills, in order, as your entire writing style.

=== SKILL 1: unslop ===
${UNSLOP_SKILL}

=== SKILL 2: i-have-adhd ===
${I_HAVE_ADHD_SKILL}
=== END OF SKILLS ===

<h3>SOURCE FIDELITY (outranks every rule above)</h3>
- Write ONLY what the brief and the task context give you. Never add content of your own.
- Never write copy, headlines, subheadlines, taglines, slogans, or product claims the source does not contain. Carrying over a line the source wrote is correct. Adding one it never wrote is a defect.
- Never invent metrics, dates, owners, acceptance criteria, tooling choices, reproduction steps, severities, versions, or numbers. If the source says "today", keep the word "today"; never resolve it to a calendar date.
- Never add constraints of your own (word limits, item counts, implementation approach, variation names) unless the source states them.
- Losing content is worse than padding. Every concrete item the source contains (each copy line, number, metric, link, name, step) must appear in the output, worded as the source worded it.
- A section the source does not cover gets "Not provided." at most once per section, never once per item, and never in place of content the source did give you.
- The result may be shorter than the source. It may NEVER be longer because you added content. Extra lines are allowed only when you split content the source already contains.

<h3>PRECEDENCE when rules conflict</h3>
1. The board's custom instructions. A template or section they require wins over brevity.
2. The user's explicit request in this run.
3. The two skills above.
4. Default brevity. Brevity applies WITHIN a section. It is never a reason to drop a section the template requires, or to compress a data-dense ticket into a summary.
- Priority and Size are judgements the product asks for on EVERY ticket, board instructions or not: always infer them from the brief (urgency words, impact words, effort words) and emit both spans. The same goes for any field the instructions REQUIRE (a score, a set of copy variations): fill it, never omit it and never mark it "Not provided." Infer it from the brief and keep the inference visible. "Never invent" governs facts you would present as given; it does not excuse you from a judgement the template asks you to make.

<h3>WEB WRITING (Nielsen Norman Group: people scan, they do not read)</h3>
- Every ticket is scanned top to bottom in an F pattern. Structure it with real HTML so a scan works:
  - <h2> for every section. A reader must be able to find any section from its heading alone. Sentence case, 2 to 4 words ("Hypothesis", "Test variations", "Success metrics"), never a full sentence.
  - First <p> under the title states the outcome or ask in one sentence. Nothing comes before it.
  - <ul><li> for anything with 2 or more parts. One idea per bullet. Nest for hierarchy.
  - 1 to 2 sentence paragraphs, 20 words or fewer per sentence where possible.
- Bold the load-bearing content with <strong>, never labels. Bold the words a reader's eye must land on to get the point of that line: the metric, the decision, the risk, the number, the action. Write "<strong>Shopify checkout started revenue</strong> is the primary metric", never "<strong>Metric:</strong> Shopify...".
- Never bold a generic label ("<strong>Primary:</strong>", "<strong>Note:</strong>", "<strong>Metric:</strong>"). Fold it into the sentence and bold the content: "<li>Primary metric is <strong>add-to-cart rate</strong></li>". The NAME of an enumerated item is content, not a label: "<li><strong>Variation 1</strong>: line under the add-to-cart button</li>" is correct.
- Enumerated things get enumerated. When the brief describes alternatives (test variations, options, candidates, steps), list them as <strong>Control</strong> (when a baseline exists), then <strong>Variation 1</strong>, <strong>Variation 2</strong> and so on, one bullet per item, in the order the brief gave them. Constraints that apply to all items ("both in German and English", "text-only") go in a sentence before or after the list, never as bullets inside it. A reader must be able to count the items.
- One to three bold phrases per section. If everything is bold, nothing is.
- Meaningful words first: start bullets and headings with the information-carrying word, not with "The", "This", "We will".
- Never rely on monospace or code blocks for emphasis. Code formatting is for code only.

<h3>OUTPUT HYGIENE</h3>
- Never output an em dash, anywhere, including inside quoted copy, marketing strings, and non-English text. Use a hyphen, comma, or period even when the source quotes it verbatim.
- Output a document fragment. Never wrap the result in <html>, <head>, or <body> tags, and never open with a code fence.

<h3>FINAL CHECK before you output, in this order</h3>
1) Every copy line, headline, slogan, number, date, and name in the output exists in the brief or the task context. If the brief did not write the copy, the output does not write it either. Delete what fails.
2) Priority and Size are present with their hidden spans.
3) No <strong> wraps a generic label. Alternatives are listed as Control, Variation 1, Variation 2, with no constraint bullets mixed into that list.
4) Every section has an <h2>. The first <p> states the ask.
5) No em dash anywhere. No <html>, <head>, <body>, no code fence.`;

export async function getCurrentUserFromCookies(): Promise<CookieUser | null> {
  try {
    const cookieStore = await cookies();
    const userCookie = cookieStore.get("nookies_user");
    if (!userCookie?.value) return null;
    return JSON.parse(userCookie.value) as CookieUser;
  } catch (error) {
    console.log("getCurrentUserFromCookies error:", error);
    return null;
  }
}

export function sseFrame(
  event: string,
  data: Record<string, unknown> | string
) {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${payload}\n\n`;
}

export function createSseErrorResponse(message: string, status = 401) {
  return new Response(
    sseFrame("error", { content: message }) +
      sseFrame("done", { status: "error" }),
    { status, headers: SSE_HEADERS }
  );
}

export function errorMessage(error: unknown) {
  const allowanceMessage = sharedAiAllowanceErrorMessage(error);
  if (allowanceMessage) return allowanceMessage;
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Sorry, an error occurred while processing your request.";
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createPromptForTiptapForwardSlash(
  mode = "FixSpellingAndGrammar",
  inputHtml = "",
  instruction = "",
) {
  if (mode === "FixSpellingAndGrammar") {
    return `<SYSTEM_INSTRUCTION>
          <INSTRUCTIONS>
              - **Format all responses exclusively in HTML** and Rich-Text-Format (RTF).
              - **IMAGE & MEDIA PRESERVATION (NON-NEGOTIABLE):** Reproduce EVERY <img>, video, iframe, audio, and embed from the input VERBATIM in your output, with the identical src and all attributes. Images are NOT text: never delete, summarize, shorten, replace, reorder, or "clean up" an <img> tag. The number of <img> tags in your output MUST equal the number in the input. Losing even one image is a critical failure.
              - Keep all links from the input intact.
              - Do **NOT** include extraneous text (e.g., "Here's the response")-just the formatted response.
              - **DO NOT** start with \`\`\`html etc. These are not readable and should be avoided.
              - **Fix spelling and grammar for the following content**
              ${NVC_STYLE_RULE}
              - This is a minimal-correction mode: only correct spelling and grammar and apply the rule above. Do NOT rewrite for brevity, structure, or style.
          </INSTRUCTIONS>
      </SYSTEM_INSTRUCTION>`;
  }

  if (mode === "Summarize") {
    return `<SYSTEM_INSTRUCTION>
            <INSTRUCTIONS>
            - **Format all responses exclusively in HTML**.
            - Summarize the following content into its key points.
            - Preserve the original meaning and every decision, date, name, and number. Do NOT add new information or answer questions.
            - **IMAGE & MEDIA PRESERVATION (NON-NEGOTIABLE):** Reproduce EVERY <img>, video, iframe, audio, and embed from the input VERBATIM, with identical src and attributes. The number of <img> tags out MUST equal the number in. Losing even one image is a critical failure.
            - Keep all links from the input intact.
            - **DO NOT** include extraneous text (e.g., "Here's the summary")-just the formatted response.
            - **DO NOT** start with \`\`\`html etc.
            ${HOUSE_OUTPUT_STYLE}
            - Never output the em dash character or other markdown formatting.
            </INSTRUCTIONS>
        </SYSTEM_INSTRUCTION>`;
  }

  if (mode === "MakeShorter") {
    return `<SYSTEM_INSTRUCTION>
            <INSTRUCTIONS>
            - **Format all responses exclusively in HTML**.
            - Make the following content shorter. Cut length significantly while preserving the meaning, tone, and every concrete fact (decisions, dates, names, numbers).
            - You are ONLY condensing existing text. DO NOT answer questions, add information, or change the meaning. Preserve all questions exactly as written.
            - Cut filler ("really", "very", "actually", "basically") and redundant phrases. Use active voice.
            - **IMAGE & MEDIA PRESERVATION (NON-NEGOTIABLE):** Reproduce EVERY <img>, video, iframe, audio, and embed from the input VERBATIM, with identical src and attributes. The number of <img> tags out MUST equal the number in. Losing even one image is a critical failure.
            - Keep all links from the input intact.
            - **DO NOT** include extraneous text-just the formatted response.
            - **DO NOT** start with \`\`\`html etc.
            ${HOUSE_OUTPUT_STYLE}
            - Never output the em dash character or other markdown formatting.
            </INSTRUCTIONS>
        </SYSTEM_INSTRUCTION>`;
  }

  if (mode.startsWith("Translate")) {
    const language = mode.includes(":")
      ? mode.split(":", 2)[1]?.trim() || "English"
      : "English";
    return `<SYSTEM_INSTRUCTION>
            <INSTRUCTIONS>
            - **Format all responses exclusively in HTML**.
            - Translate the TEXT of the following content into ${language}. Output only the translated content, nothing else.
            - Translate text only. Do NOT translate, alter, or drop URLs, code inside <code> or <pre>, email addresses, or @mentions. Keep them exactly as-is.
            - Preserve the meaning and tone faithfully. Do NOT answer questions, summarize, shorten, or add information. Translate questions as questions.
            - **IMAGE & MEDIA PRESERVATION (NON-NEGOTIABLE):** Reproduce EVERY <img>, video, iframe, audio, and embed from the input VERBATIM, with identical src and attributes. The number of <img> tags out MUST equal the number in. Losing even one image is a critical failure.
            - Keep all links from the input intact (translate only the visible anchor text, never the href).
            - Preserve the original HTML structure (headings, lists, bold, paragraphs).
            - **DO NOT** include extraneous text (e.g., "Here's the translation")-just the translated HTML.
            - **DO NOT** start with \`\`\`html etc.
            - No hashtags, asterisks, or markdown formatting. Never output the em dash character.
            </INSTRUCTIONS>
        </SYSTEM_INSTRUCTION>`;
  }

  if (mode === "Simplify") {
    return `<SYSTEM_INSTRUCTION>
            <INSTRUCTIONS>
            - **Format all responses exclusively in HTML**.
            - Simplify the following content with simpler words and shorter sentences.
            - You are ONLY rewriting existing text. DO NOT answer questions or add new information. Preserve questions as questions.
            - **IMAGE & MEDIA PRESERVATION (NON-NEGOTIABLE):** Reproduce EVERY <img>, video, iframe, audio, and embed from the input VERBATIM, with identical src and attributes. The number of <img> tags out MUST equal the number in.
            - Keep all links from the input intact.
            - **DO NOT** include extraneous text-just the formatted response.
            - **DO NOT** start with \`\`\`html etc.
            ${HOUSE_OUTPUT_STYLE}
            - Never output the em dash character or other markdown formatting.
            </INSTRUCTIONS>
        </SYSTEM_INSTRUCTION>`;
  }

  if (mode === "Unslop") {
    return `<SYSTEM_INSTRUCTION>
            <INSTRUCTIONS>
            - **Format all responses exclusively in HTML**.
            - Remove puffery, chatbot phrases, and AI tells. Cut filler, hedging, synonym cycling, and promotional adjectives.
            - Prefer plain speech, active voice, specific facts. Have a human tone without being cute.
            - You are ONLY rewriting existing text. DO NOT answer questions or add new information.
            - **IMAGE & MEDIA PRESERVATION (NON-NEGOTIABLE):** Reproduce EVERY <img>, video, iframe, audio, and embed from the input VERBATIM, with identical src and attributes. The number of <img> tags out MUST equal the number in.
            - Keep all links from the input intact.
            - **DO NOT** include extraneous text-just the formatted response.
            - **DO NOT** start with \`\`\`html etc.
            ${HOUSE_OUTPUT_STYLE}
            - Never output the em dash character or other markdown formatting.
            </INSTRUCTIONS>
        </SYSTEM_INSTRUCTION>`;
  }

  if (mode === "ImproveReadability" || mode === "Structured") {
    return `<SYSTEM_INSTRUCTION>
            <INSTRUCTIONS>
            - **Format all responses exclusively in HTML**.
            ${STRUCTURED_WRITING_STYLE}
            - **IMAGE & MEDIA PRESERVATION (NON-NEGOTIABLE):** Reproduce EVERY <img>, video, iframe, audio, and embed from the input VERBATIM, with identical src and attributes. The number of <img> tags out MUST equal the number in.
            - Keep all links from the input intact.
            - **DO NOT** include extraneous text-just the formatted response.
            - **DO NOT** start with \`\`\`html etc.
            ${HOUSE_OUTPUT_STYLE}
            - Never output the em dash character or other markdown formatting.
            </INSTRUCTIONS>
        </SYSTEM_INSTRUCTION>`;
  }

  if (mode === "CustomEdit" || mode.startsWith("CustomEdit:")) {
    const requestedInstruction =
      instruction.trim() || mode.slice("CustomEdit:".length).trim();
    return `<SYSTEM_INSTRUCTION>
            <INSTRUCTIONS>
            - **Format all responses exclusively in HTML**.
            - Apply this edit instruction to the selected content only: ${requestedInstruction || "Improve the writing while preserving meaning."}
            - You are ONLY rewriting the selected content.
            - DO NOT answer the instruction as a chatbot. Output the edited content only.
            - **IMAGE & MEDIA PRESERVATION (NON-NEGOTIABLE):** Reproduce EVERY <img>, video, iframe, audio, and embed from the input VERBATIM, with identical src and attributes. The number of <img> tags out MUST equal the number in unless the instruction requires removing them.
            - Keep all links from the input intact unless the instruction requires changing them.
            - **DO NOT** include extraneous text-just the formatted response.
            - **DO NOT** start with \`\`\`html etc.
            ${HOUSE_OUTPUT_STYLE}
            - Never output the em dash character or other markdown formatting.
            </INSTRUCTIONS>
        </SYSTEM_INSTRUCTION>`;
  }

  if (mode === "WriteContent" || mode.startsWith("WriteContent:")) {
    const requestedInstruction =
      instruction.trim() || mode.slice("WriteContent:".length).trim();
    return `<SYSTEM_INSTRUCTION>
            <INSTRUCTIONS>
            - **Format all responses exclusively in HTML**.
            - Write new content based on this instruction: ${requestedInstruction || "Write a short useful draft."}
            - This will be pasted into a comment/description editor. Write in the user's voice.
            - Do NOT answer as a chatbot. Output only the draft HTML.
            - **DO NOT** start with \`\`\`html etc.
            ${HOUSE_OUTPUT_STYLE}
            - Never output the em dash character or other markdown formatting.
            </INSTRUCTIONS>
        </SYSTEM_INSTRUCTION>`;
  }

  return `<SYSTEM_INSTRUCTION>
            <INSTRUCTIONS>
            - **Format all responses exclusively in HTML**.
            - Return the following content with light copy-editing only. Do NOT add, remove, or reinterpret information.
            - **IMAGE & MEDIA PRESERVATION (NON-NEGOTIABLE):** Reproduce EVERY <img>, video, iframe, audio, and embed from the input VERBATIM, with identical src and attributes.
            - Keep all links from the input intact.
            - **DO NOT** include extraneous text-just the formatted response.
            - **DO NOT** start with \`\`\`html etc.
            </INSTRUCTIONS>
        </SYSTEM_INSTRUCTION>`;
}

export function createKanbanSystemPrompt(mode = "default") {
  if (mode === "task_writer") {
    return createTaskWriterSystemPromptTemplate(TASK_AUTHORING_STYLE);
  }

  if (mode === "write_with_ai") {
    return `<SYSTEM_INSTRUCTION>
            <INSTRUCTIONS>
            <h3>What you are doing</h3>
            - You are drafting a COMMENT that the user is about to post on this task. You ARE the user.
            - This is NOT a chat. Do NOT answer the person who invoked you.
            - The user's typed input is the message. Your comment MUST be about what the input says.
            - If the input is a question asking for information the user does not have, the comment IS that question: polish it and address it to the thread.
            - NEVER invent facts, statuses, dates, findings, decisions, or progress.
            - Use task context only to get names, terminology, and current state right.
            - Write in the user's voice, first person where natural.
            - Format exclusively in HTML. Do NOT start with code fences.
            - Do NOT use task structures like <h1 id="ai-generated-task-title">.
            - Use <p>, <ul>, <li>, <strong>, <em> as needed.
            ${TASK_AUTHORING_STYLE}
            - If the user asks to lengthen or extend, ignore the brevity limits and word-count target above. Keep the result scannable and follow every other style rule.
            - Keep all images, videos, iframes, embeds, and links from the input exactly.
            - For external links, add target="_blank" rel="noopener noreferrer".
            - Never set color, background-color, or border-color.
            - Output ONLY the finished comment HTML. No preamble, no sign-off, no explanation.
            </INSTRUCTIONS>
        </SYSTEM_INSTRUCTION>`;
  }

  return `<SYSTEM_INSTRUCTION>
            <INSTRUCTIONS>
                - Format all responses in semantic HTML.
                - No markdown wrappers.
                - Extract and preserve all links from context.
                - For external links, add target="_blank" rel="noopener noreferrer".
                - All images, videos, and iframes must be preserved.
            </INSTRUCTIONS>
        </SYSTEM_INSTRUCTION>`;
}

export function stripCodeFences(text: string) {
  try {
    if (!text) return text;
    let trimmed = text.trim();
    trimmed = trimmed.replace(CODE_FENCE_OPEN_RE, "");
    trimmed = trimmed.replace(CODE_FENCE_CLOSE_RE, "");
    return trimmed.trim();
  } catch {
    return text;
  }
}

function imgSrc(tag: string) {
  const match = IMG_SRC_RE.exec(tag || "");
  return match?.[1];
}

export function reinjectMissingImages(inputHtml: string, outputHtml: string) {
  try {
    const inputTags = Array.from((inputHtml || "").matchAll(IMG_TAG_RE)).map(
      (match) => match[0]
    );
    if (inputTags.length === 0) return outputHtml;

    const outputSrcs = new Set(
      Array.from((outputHtml || "").matchAll(IMG_TAG_RE))
        .map((match) => imgSrc(match[0]))
        .filter((src): src is string => Boolean(src))
    );
    const seen = new Set<string>();
    const missing: string[] = [];

    for (const tag of inputTags) {
      const src = imgSrc(tag);
      if (!src || outputSrcs.has(src) || seen.has(src)) continue;
      seen.add(src);
      missing.push(tag);
    }

    if (missing.length === 0) return outputHtml;
    return (outputHtml || "") + missing.map((tag) => `<p>${tag}</p>`).join("");
  } catch {
    return outputHtml;
  }
}

export function normalizeTiptapOutput(inputHtml: string, outputHtml: string) {
  return reinjectMissingImages(inputHtml, stripCodeFences(outputHtml));
}

// HTML-canvas blocks (Pages) are opaque base64 islands rendered only in a
// sandboxed iframe. Their payload is useless to the language model and would be
// dropped or corrupted by an AI edit, so we pull them out before the model runs
// and splice them back afterwards. Mirrors the image-preservation approach above.
const HTML_BLOCK_RE = /<div\b[^>]*\bdata-html-block\b[^>]*><\/div>/gi;
const HTML_BLOCK_PLACEHOLDER_RE = /<!--HTMLBLOCK_(\d+)-->/g;

export function extractHtmlBlocks(html: string): {
  stripped: string;
  blocks: string[];
} {
  const blocks: string[] = [];
  const stripped = (html || "").replace(HTML_BLOCK_RE, (match) => {
    const index = blocks.length;
    blocks.push(match);
    return `<!--HTMLBLOCK_${index}-->`;
  });
  return { stripped, blocks };
}

export function reattachHtmlBlocks(html: string, blocks: string[]): string {
  if (blocks.length === 0) return html || "";
  const used = new Set<number>();
  let out = (html || "").replace(HTML_BLOCK_PLACEHOLDER_RE, (_match, n) => {
    const index = Number(n);
    if (blocks[index] != null) {
      used.add(index);
      return blocks[index];
    }
    return "";
  });
  // Append any block whose marker the model dropped, so a canvas block is never
  // lost to an AI edit (worst case it moves to the end, never disappears).
  const lost = blocks.filter((_, index) => !used.has(index));
  if (lost.length > 0) out += lost.join("");
  return out;
}

export function extractImgSrcs(htmlText: string) {
  const srcs = new Set<string>();
  for (const match of (htmlText || "").matchAll(IMG_TAG_RE)) {
    const src = imgSrc(match[0]);
    if (src) srcs.add(src.trim());
  }
  return srcs;
}

export function filterOneImagePass(text: string, allowedSrcs: Set<string>) {
  const out: string[] = [];
  let i = 0;
  const lower = text.toLowerCase();

  while (true) {
    const start = lower.indexOf("<img", i);
    if (start === -1) {
      const rest = text.slice(i);
      let keep = 0;
      for (let k = Math.min(4, rest.length); k > 0; k--) {
        if ("<img".startsWith(rest.slice(-k).toLowerCase())) {
          keep = k;
          break;
        }
      }
      if (keep) {
        out.push(rest.slice(0, -keep));
        return { emit: out.join(""), leftover: rest.slice(-keep) };
      }
      out.push(rest);
      return { emit: out.join(""), leftover: "" };
    }

    out.push(text.slice(i, start));
    const end = text.indexOf(">", start);
    if (end === -1) {
      return { emit: out.join(""), leftover: text.slice(start) };
    }

    const tag = text.slice(start, end + 1);
    const src = imgSrc(tag)?.trim();
    if (src && allowedSrcs.has(src)) out.push(tag);
    i = end + 1;
  }
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export function normalizeProvider(sourceSelected?: string | null): ProviderId {
  const source = (sourceSelected ?? "").trim().toLowerCase();
  if (
    source === "claude" ||
    source === "openai" ||
    source === "openrouter" ||
    source === "gateway" ||
    source === "custom"
  ) {
    return source;
  }
  return DEFAULT_PROVIDER;
}

function claudeAcceptsTemperature(model: string | null | undefined) {
  const normalized = String(model || "").toLowerCase();
  return !CLAUDE_TEMPERATURE_UNSUPPORTED_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix)
  );
}

function selectionFromModelOption(option: TAiModelOption): {
  provider: ProviderId;
  model: string;
  modelOption: TAiModelOption;
} {
  return {
    provider: option.source,
    model: option.model,
    modelOption: option,
  };
}

export function defaultModelSelection(
  settings?: unknown,
  feature: UserFacingModelFeature = "taskWriter",
  personalModelOptionId?: string | null,
  customEndpointConfigured = true,
  defaultModelOption = defaultAiModelOption,
) {
  const option = resolveUserFacingModelOption(
    feature,
    settings,
    personalModelOptionId,
    { customEndpointConfigured, defaultModelOption }
  );
  if (!option) throw new Error("This AI feature is turned off for your team");
  return selectionFromModelOption(filterModelOptionForTeam(option, settings));
}

function resolveTaskWriterSelection(
  sourceSelected?: string | null,
  modelSelected?: string | null,
  modelOptionId?: string | null,
  defaultModelOption = defaultAiModelOption,
): { provider: ProviderId; model: string; modelOption?: TAiModelOption } {
  const provider = normalizeProvider(sourceSelected);
  const requestedModel = modelSelected?.trim();

  if (provider === "openrouter") {
    return requestedModel
      ? { provider, model: requestedModel }
      : defaultModelSelection(
          undefined,
          "taskWriter",
          undefined,
          true,
          defaultModelOption,
        );
  }

  const modelOption =
    getAiModelOptionById(modelOptionId) ?? getAiModelOptionById(requestedModel);
  if (modelOption) {
    return selectionFromModelOption(modelOption);
  }

  return defaultModelSelection(
    undefined,
    "taskWriter",
    undefined,
    true,
    defaultModelOption,
  );
}

function normalizeGatewayTeamId(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function gatewayTagsForLookup(args?: {
  teamId?: unknown;
  projectId?: number | null;
  userId?: number | null;
}): AiGatewayTags | undefined {
  const teamId = normalizeGatewayTeamId(args?.teamId);
  const projectId = args?.projectId ?? null;
  const userId = args?.userId ?? null;
  if (!teamId && projectId == null && userId == null) return undefined;
  return { teamId, projectId, userId };
}

function editorUsageMiddleware(args: {
  userId?: number | null;
  teamId?: string | null;
  projectId?: number | null;
  taskId?: number | null;
  agentId?: string | null;
  provider: string;
  model: string;
}): LanguageModelMiddleware {
  const logUsage = async (usage: {
    inputTokens: { total?: number };
    outputTokens: { total?: number };
  }) => {
    if (!args.userId) return;
    const inputTokens = usage.inputTokens.total ?? 0;
    const outputTokens = usage.outputTokens.total ?? 0;
    await logAiUsage({
      userId: args.userId,
      teamId: args.teamId,
      projectId: args.projectId,
      taskId: args.taskId,
      agentId: args.agentId,
      provider: args.provider,
      model: args.model,
      feature: "editor",
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    });
  };

  return {
    specificationVersion: "v4",
    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate();
      await logUsage(result.usage);
      return result;
    },
    wrapStream: async ({ doStream }) => {
      const result = await doStream();
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream({
            async transform(chunk, controller) {
              if (chunk.type === "finish") await logUsage(chunk.usage);
              controller.enqueue(chunk);
            },
          })
        ),
      };
    },
  };
}

export async function selectTiptapModel(args?: {
  teamId?: unknown;
  projectId?: number | null;
  userId?: number | null;
  taskId?: number | null;
  agentId?: string | null;
  teamContext?: { teamId: string | null; settings: unknown };
}): Promise<SelectedModel> {
  const selected = await selectTaskWriterModel({
    teamId: args?.teamId,
    projectId: args?.projectId,
    userId: args?.userId,
    feature: "editor",
    aiFeature: "improveWriting",
    agentId: args?.agentId ?? null,
    teamContext: args?.teamContext,
  });

  return {
    ...selected,
    model: wrapLanguageModel({
      model: selected.model as Parameters<typeof wrapLanguageModel>[0]["model"],
      middleware: editorUsageMiddleware({
        userId: args?.userId,
        teamId: selected.teamId,
        projectId: args?.projectId,
        taskId: args?.taskId,
        agentId: args?.agentId,
        provider: selected.usageProvider,
        model: selected.modelId,
      }),
    }),
  };
}

export function selectEditorModel(
  provider: ProviderId,
  modelId: string | null | undefined,
  byokCredential?: AiModelCredential,
  options?: {
    includeNativeWebSearch?: boolean;
    feature?: AiGatewayFeature;
    tags?: AiGatewayTags;
    modelOption?: TAiModelOption;
  }
): SelectedModel {
  const requestedModel = modelId?.trim() || undefined;
  const feature = options?.feature ?? "task-writer";
  const usageProvider = aiUsageProviderForCredential(
    provider,
    byokCredential,
    options?.modelOption
  );

  switch (provider) {
    case "claude": {
      const model =
        requestedModel && CLAUDE_MODELS.has(requestedModel)
          ? requestedModel
          : DEFAULT_CLAUDE_MODEL;
      const aiModel = resolveAiModel(provider, model, byokCredential);
      const directApiKey = isVercelAiGatewayKey(byokCredential)
        ? undefined
        : typeof byokCredential === "string"
          ? byokCredential
          : undefined;
      const anthropic = createAnthropic({
        apiKey: directApiKey ?? "",
      });
      return {
        provider,
        usageProvider,
        modelId: model,
        model: aiModel,
        providerOptions: providerOptionsForAiModel(
          aiModel,
          feature,
          options?.tags,
          options?.modelOption
        ),
        settings: {
          ...(claudeAcceptsTemperature(model) ? { temperature: 0.2 } : {}),
          maxOutputTokens: 16000,
        },
        tools: options?.includeNativeWebSearch
          ? ({
              web_search: anthropic.tools.webSearch_20250305({ maxUses: 5 }),
            } as ToolSet)
          : undefined,
      };
    }
    case "openrouter": {
      if (!requestedModel) {
        return selectEditorModel(
          DEFAULT_PROVIDER,
          DEFAULT_MODEL,
          undefined,
          options
        );
      }
      const aiModel = resolveAiModel(provider, requestedModel, byokCredential);
      return {
        provider,
        usageProvider,
        modelId: requestedModel,
        model: aiModel,
        providerOptions: providerOptionsForAiModel(
          aiModel,
          feature,
          options?.tags
        ),
        settings: { temperature: 0.2, maxOutputTokens: 16000 },
      };
    }
    case "gateway": {
      const model = requestedModel || defaultAiModelOption.model;
      const aiModel = resolveAiModel(
        provider,
        model,
        byokCredential,
        options?.modelOption
      );
      return {
        provider,
        usageProvider,
        modelId: model,
        model: aiModel,
        providerOptions: providerOptionsForAiModel(
          aiModel,
          feature,
          options?.tags,
          options?.modelOption
        ),
        settings: { temperature: 0.2, maxOutputTokens: 16000 },
      };
    }
    case "custom": {
      if (!isCustomEndpointConfig(byokCredential)) {
        throw new Error("A complete custom endpoint is required");
      }
      const aiModel = resolveAiModel(provider, "custom", byokCredential);
      return {
        provider,
        usageProvider,
        modelId: byokCredential.modelId,
        model: aiModel,
        providerOptions: undefined,
        settings: { temperature: 0.2, maxOutputTokens: 16000 },
      };
    }
    case "openai":
    default: {
      const model =
        requestedModel && OPENAI_MODELS.has(requestedModel)
          ? requestedModel
          : DEFAULT_MODEL;
      const aiModel = resolveAiModel("openai", model, byokCredential);
      const directApiKey = isVercelAiGatewayKey(byokCredential)
        ? undefined
        : typeof byokCredential === "string"
          ? byokCredential
          : undefined;
      const openai = createOpenAI({
        apiKey: directApiKey ?? "",
      });
      return {
        provider: "openai",
        usageProvider,
        modelId: model,
        model: aiModel,
        providerOptions: providerOptionsForAiModel(
          aiModel,
          feature,
          options?.tags,
          options?.modelOption
        ),
        settings: {
          temperature: model.toLowerCase().startsWith("gpt-5") ? 1 : 0.2,
          maxOutputTokens: 16000,
        },
        tools: options?.includeNativeWebSearch
          ? ({ web_search: openai.tools.webSearch() } as ToolSet)
          : undefined,
      };
    }
  }
}

const PERSONAL_MODEL_SURFACES: Partial<
  Record<UserFacingModelFeature, TAiModelPreferenceSurface>
> = {
  aiChat: "aiChat",
  taskWriter: "taskWriter",
  writeWithAi: "writeWithAi",
  improveWriting: "improveWriting",
  askAi: "askAi",
};

async function getPersonalModelOptionId(
  userId: number | null | undefined,
  teamId: string | null,
  feature: UserFacingModelFeature
) {
  const surface = PERSONAL_MODEL_SURFACES[feature];
  if (!userId || !surface) return null;
  const userSetting = await prisma.userSetting.findUnique({
    where: { userId },
    select: { aiModelPreferences: true },
  });
  const ids = getAiModelPreferenceIds(
    userSetting?.aiModelPreferences as TAiModelPreferences | null | undefined,
    surface,
    teamId
  );
  return ids.teamScoped ?? ids.global ?? null;
}

export async function selectTaskWriterModel(args: {
  sourceSelected?: string | null;
  modelSelected?: string | null;
  modelOptionId?: string | null;
  byokProviderFlags?: ByokProviderFlag[] | null;
  teamId?: unknown;
  projectId?: number | null;
  userId?: number | null;
  feature?: AiGatewayFeature;
  aiFeature?: UserFacingModelFeature;
  teamContext?: { teamId: string | null; settings: unknown };
  /**
   * The native agent this call runs as, when there is one. An agent carrying
   * its own provider credential runs on that account instead of the team's
   * (HTPR-5389). Server-derived only, never request input.
   */
  agentId?: string | null;
}) {
  const teamContext =
    args.teamContext ??
    (await getProjectTeamProviderContext(args.projectId, args.userId));
  const keyLookup = teamContext.teamId
    ? {
        trustedTeamId: teamContext.teamId,
        userId: args.userId,
        agentId: args.agentId ?? null,
      }
    : {
        teamId: args.teamId,
        projectId: args.projectId,
        userId: args.userId,
        agentId: args.agentId ?? null,
      };
  const storePlanId = await storePlanIdForProject(
    teamContext.teamId ? undefined : args.projectId,
    teamContext.teamId,
  );
  let hasEligibleByokCredential = false;
  if (storePlanId === "BYOK") {
    const credential = await getByokOrTeamGatewayApiKeyForModelOption(
      preferredAiModelOption,
      args.byokProviderFlags,
      keyLookup,
    );
    const sharedKey = process.env.AI_GATEWAY_API_KEY?.trim();
    hasEligibleByokCredential =
      (typeof credential === "string" &&
        credential.trim().length > 0 &&
        credential.trim() !== sharedKey) ||
      (credential !== null && typeof credential === "object");
  }
  const requestDefaultModelOption = getDefaultAiModelOptionForPlan(
    storePlanId,
    hasEligibleByokCredential,
  );
  const personalModelOptionId = args.aiFeature
    ? await getPersonalModelOptionId(
        args.userId,
        teamContext.teamId,
        args.aiFeature
      )
    : null;
  let selection = args.aiFeature
    ? defaultModelSelection(
        teamContext.settings,
        args.aiFeature,
        personalModelOptionId,
        true,
        requestDefaultModelOption,
      )
    : resolveTaskWriterSelection(
        args.sourceSelected,
        args.modelSelected,
        args.modelOptionId,
        requestDefaultModelOption,
      );
  if (selection.modelOption) {
    selection = selectionFromModelOption(
      filterModelOptionForTeam(selection.modelOption, teamContext.settings)
    );
  }

  const getSelectionApiKey = (
    selected: ReturnType<typeof resolveTaskWriterSelection>
  ) =>
    selected.modelOption
      ? getByokOrTeamGatewayApiKeyForModelOption(
          selected.modelOption,
          args.byokProviderFlags,
          keyLookup
        )
      : selected.provider === "gateway"
        ? getTeamGatewayApiKey(keyLookup)
        : getByokOrTeamGatewayApiKeyForProvider(
            selected.provider,
            args.byokProviderFlags,
            keyLookup
          );
  let byokApiKey = await getSelectionApiKey(selection);

  if (selection.provider === "custom" && !isCustomEndpointConfig(byokApiKey)) {
    selection = defaultModelSelection(
      teamContext.settings,
      args.aiFeature ?? "taskWriter",
      personalModelOptionId,
      false,
      requestDefaultModelOption,
    );
    byokApiKey = await getSelectionApiKey(selection);
  }

  if (selection.provider === "openrouter") {
    if (isVercelAiGatewayKey(byokApiKey)) {
      selection = defaultModelSelection(
        teamContext.settings,
        args.aiFeature ?? "taskWriter",
        personalModelOptionId,
        true,
        requestDefaultModelOption,
      );
    } else if (!byokApiKey) {
      selection = defaultModelSelection(
        teamContext.settings,
        args.aiFeature ?? "taskWriter",
        personalModelOptionId,
        true,
        requestDefaultModelOption,
      );
      byokApiKey = await getSelectionApiKey(selection);
    }
  }

  await assertModelAllowedForPlan(
    args.projectId,
    selection.modelOption,
    teamContext.teamId,
    byokApiKey,
  );

  const tags = gatewayTagsForLookup({
    teamId: args.projectId ? teamContext.teamId : args.teamId,
    projectId: args.projectId,
    userId: args.userId,
  });
  const selectedModel = selectEditorModel(
    selection.provider,
    selection.model,
    byokApiKey,
    {
      feature: args.feature ?? "task-writer",
      tags,
      modelOption: selection.modelOption,
      includeNativeWebSearch:
        selection.provider === "claude" || selection.provider === "openai",
    }
  );
  return {
    ...selectedModel,
    teamId: teamContext.teamId ?? normalizeGatewayTeamId(args.teamId),
  };
}

export function createTaskAndModelContext(args: {
  taskIds?: number[];
  modelSelected: string;
  taskDescription?: string;
  taskTitle?: string;
}) {
  const taskIds = args.taskIds ?? [];
  let context = `
    MODEL CONTEXT
    - Current LLM Model being used for response: ${args.modelSelected}

    LINK REFERENCING FOR OPENAI MODELS ONLY:
    - If you are currently an OpenAI Model, then override your previous command about Link Handling.
    - ONLY showcase the top 6 links that are very crucial to the query.
    - DO NOT reference any images or videos.
    - ONLY reference to comment links if there are no task links.
    `;

  if (taskIds.length > 1) {
    context += `
        TASK PRIORITY RELEVANCE
        Current Primary Task ID: ${taskIds[0]}
        Related Task IDs: ${taskIds.slice(1).join(", ")}

        When analyzing retrieved documents:
        - Documents from Task ID ${taskIds[0]} are from the PRIMARY/CURRENT task and should be given highest relevance
        - Documents from Task IDs ${taskIds.slice(1).join(", ")} are from RELATED tasks and should be considered as supporting context
        - Prioritize information from the primary task when there are conflicts or when making recommendations
        `;
  }

  if (
    (args.taskDescription ?? "").length > 0 &&
    (args.taskTitle ?? "").length > 0
  ) {
    context += `
        CURRENT TASK CONTEXT
        - Task Title: ${args.taskTitle}
        - Task Description: ${escapeHtml(args.taskDescription ?? "")}

        Please keep this task context in mind when generating responses and prioritize information that is relevant to achieving this specific task.
        `;
  }

  return context;
}

export function createUploadedDocumentsContext(uploadedDocuments: string) {
  return `
    <UPLOADED_DOCUMENTS>
    IMPORTANT: The user has provided uploaded documents that contain key content for this task. These documents should receive special attention and be integrated with the project context.

    UPLOADED CONTENT:
    ${uploadedDocuments}

    INTEGRATION INSTRUCTIONS:
    - Give special focus to the uploaded documents as they contain user-provided content.
    - Integrate this content with relevant project context and retrieved information.
    - Use the uploaded documents as primary source material while incorporating supporting project details.
    - Create task descriptions that leverage both uploaded content and project knowledge.
    </UPLOADED_DOCUMENTS>
    `;
}

export function createTaskWriterPromptParts(args: {
  aiMode?: string | null;
  customInstructions?: string | null;
  boardTemplates?: BoardTemplateContext[];
  modelSelected: string;
  taskIds?: number[];
  taskDescription?: string | null;
  taskTitle?: string | null;
  retrievedContext: string;
  uploadedDocumentContext?: string;
  input: string;
}) {
  const promptMode =
    args.aiMode === "AiTaskWriter"
      ? "task_writer"
      : args.aiMode === "WriteWithAI"
        ? "write_with_ai"
        : "default";

  const instructions = createKanbanSystemPrompt(promptMode);

  const reminderParts: string[] = [];
  // Board custom instructions apply in every AI entry point, WriteWithAI
  // included. A board sets policy there ("never claim disease prevention in ad
  // copy"), and policy that holds in one entry point but not another is a
  // compliance footgun, not a feature (HTPR-4356).
  const customInstructions = args.customInstructions
    ? `<CUSTOM_INSTRUCTION>${args.customInstructions}</CUSTOM_INSTRUCTION>`
    : "";
  if (customInstructions) reminderParts.push(customInstructions);
  const boardTemplates = createBoardTemplatesBlock(args.boardTemplates);
  if (boardTemplates) reminderParts.push(boardTemplates);

  const escapedDescription = escapeHtml(args.taskDescription ?? "");
  const taskModelContext = createTaskAndModelContext({
    taskIds: args.taskIds,
    modelSelected: args.modelSelected,
    taskDescription: escapedDescription,
    taskTitle: args.taskTitle ?? "",
  });
  if (taskModelContext) reminderParts.push(taskModelContext);

  if (args.uploadedDocumentContext) {
    reminderParts.push(
      createUploadedDocumentsContext(args.uploadedDocumentContext)
    );
  }

  const systemReminder = reminderParts.length
    ? "<system-reminder>\n" +
      reminderParts.join("\n") +
      "\n</system-reminder>\n\n"
    : "";
  // Retrieved ticket text is user-authored data. Keep it in the user message,
  // below the actual system instructions, so a comment cannot become policy by
  // imitating one of the prompt's XML-like delimiters.
  const retrievedContext = args.retrievedContext
    ? wrapTaskWriterContext(args.retrievedContext) + "\n\n"
    : "";
  const input = systemReminder + retrievedContext + args.input;

  return { instructions, input };
}

function dataUrlToFilePart(
  value: string,
  mediaType: string,
  filename?: string | null
): FilePart | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(value);
  if (!match) return null;
  return {
    type: "file",
    mediaType: mediaType || match[1] || "application/octet-stream",
    filename: filename ?? undefined,
    data: { type: "data", data: match[3] || "" },
  };
}

export function filePartFromTaskWriterFile(
  file: TaskWriterFile
): FilePart | null {
  const raw = file.url || file.base64 || file.data;
  if (!raw) return null;
  const mediaType = file.mimeType || file.type || "application/octet-stream";
  const dataUrl = dataUrlToFilePart(raw, mediaType, file.fileName);
  if (dataUrl) return dataUrl;

  const looksBase64 =
    /^[A-Za-z0-9+/=\s]+$/.test(raw) && raw.replace(/\s/g, "").length > 100;
  if (looksBase64 && !raw.startsWith("http")) {
    return {
      type: "file",
      mediaType,
      filename: file.fileName ?? undefined,
      data: { type: "data", data: raw.replace(/\s/g, "") },
    };
  }

  try {
    return {
      type: "file",
      mediaType,
      filename: file.fileName ?? undefined,
      data: new URL(raw),
    };
  } catch {
    return null;
  }
}

export function createTaskWriterUserContent(
  input: string,
  files: TaskWriterFile[]
): UserContent {
  const fileParts = files
    .map(filePartFromTaskWriterFile)
    .filter((part): part is FilePart => part !== null);
  if (fileParts.length === 0) return input;
  return [{ type: "text", text: input }, ...fileParts];
}

function taskRowToContext(row: TurbopufferTaskRow) {
  return [
    `taskId:${row.uniqueIndex}`,
    `projectId:${row.projectId}`,
    row.ticketNumber ? `ticketNumber:${row.ticketNumber}` : "",
    row.title ? `title:${row.title}` : "",
    row.descriptionText ? `description:${row.descriptionText}` : "",
    row.status ? `status:${row.status}` : "",
    row.projectTitle ? `project:${row.projectTitle}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function commentRowToContext(row: TurbopufferCommentRow) {
  return [
    `taskId:${row.taskUniqueIndex}`,
    `projectId:${row.projectId}`,
    `commentId:${row.id}`,
    row.taskTicketNumber ? `ticketNumber:${row.taskTicketNumber}` : "",
    row.taskTitle ? `taskTitle:${row.taskTitle}` : "",
    row.commentText ? `comment:${row.commentText}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export async function retrieveTaskWriterContext(args: {
  projectId: number;
  projectIds?: number[];
  prompt: string;
  aiMode?: string | null;
  taskIds?: number[];
}) {
  const taskIds = (args.taskIds ?? []).filter((id) => Number.isInteger(id));
  const projectIds = args.projectIds?.length
    ? args.projectIds
    : [args.projectId];

  const [taskRowsRaw, commentRowsRaw, customInstructionFileContext] =
    await Promise.all([
      searchTasks({
        searchQuery: args.prompt,
        projectIds,
        topK: 50,
      }),
      searchComments({
        searchQuery: args.prompt,
        projectIds,
        topK: 60,
        limit: 50,
      }),
      retrieveCustomInstructionFileContext({
        projectId: args.projectId,
        prompt: args.prompt,
      }),
    ]);

  // Full content for every supplied ticket is loaded separately. Exclude those
  // tickets from semantic results so a prompt-similar comment is not repeated
  // and accidentally weighted more heavily than the rest of its thread.
  const { taskRows, commentRows } = excludeLoadedTaskRows({
    taskRows: taskRowsRaw,
    commentRows: commentRowsRaw,
    loadedTaskIds: taskIds,
  });

  const projectContext = [
    ...taskRows.map(taskRowToContext),
    ...commentRows.map(commentRowToContext),
  ]
    .slice(0, 50)
    .join("\n\n");

  return [projectContext, customInstructionFileContext]
    .filter(Boolean)
    .join("\n\n");
}

export function createDocumentAttachmentSummary(files: TaskWriterFile[]) {
  const namedFiles = files
    .map((file) => file.fileName || file.url || file.base64 || file.data || "")
    .filter(Boolean);
  if (namedFiles.length === 0) return "";
  return namedFiles
    .map(
      (name, index) =>
        `--- Content from ${name} ---\nChunk 1:\n[Attached file ${index + 1}: ${name}]`
    )
    .join("\n");
}
