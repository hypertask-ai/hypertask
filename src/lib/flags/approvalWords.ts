import { parse } from "node-html-parser";

export const FLAG_CHAT_RECORD_AGENT_ID = "9b0f3a93-5e88-4093-b558-cad1c229bc51";

export function normalizeVisibleText(html: string): string {
  return parse(html).text.normalize("NFKC")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

export function classifyAnswer(text: string): "yes" | "no" | "unclear" {
  const answer = text.normalize("NFKC").replace(/[‘’]/g, "'").toLowerCase().replace(/\s+/g, " ").trim()
    .replace(/^@(?:valentin yeo|ht product lead)\b[\s,:-]*/, "");
  const tokens = answer.match(/[\p{L}\p{N}']+|👍|👎/gu) ?? [];
  const words = tokens.join(" ");
  const answerWords = tokens.filter((token) => token !== "👍" && token !== "👎");
  if (/^(?:no|nope|nah|dont|don't|not|never|stop|hold)$/.test(answerWords[0] ?? "")
    || (answerWords[0] === "do" && answerWords[1] === "not") || words === "👎") return "no";
  if (answer.includes("?")) return "unclear";
  if (/(?:^| )(?:no|not|never|don't|dont|do not|can't|cannot|won't|wait|later|hold|stop|but|unless|until|if|maybe|perhaps|only|except|however|instead|failed|broken|bug|👎)(?: |$)/.test(words)) return "unclear";
  if (!/(?:^| )(?:yes|yep|yeah|yup|ok|okay|approve|approved|lgtm|ship it|release it|go ahead|go for it|do it|flip it|switch it|turn it on|looks good|👍)(?: |$)/.test(words)) return "unclear";
  const vocabulary = new Set("yes yep yeah yup ok okay approve approved lgtm ship it release go ahead for do flip switch turn on looks good 👍 this that the flag please pls now sure great fine works working all everyone live and thanks thank you perfect 100".split(" "));
  return tokens.every((token) => vocabulary.has(token)) ? "yes" : "unclear";
}

const TEMPLATE_LABEL = /(what this is|question|my recommendation|why|yes|no)\s*:/gi;
const QUOTED = /"[^"]*(?:"|$)/g;
const ADVICE_HEDGE = /\b(?:no|not|don't|dont|do not|never|wait|later|hold|stop|cancel|only|if|unless|instead|except|but)\b/i;

export function templateQuestionRequest(text: string): string | null {
  const masked = text.replace(QUOTED, (span) => " ".repeat(span.length));
  const labels = [...masked.matchAll(TEMPLATE_LABEL)]
    .filter((match) => match.index === 0 || /[\s.!?:*-]/.test(masked[match.index - 1]));
  const first = labels[0];
  const questions = labels.filter((match) => match[1].toLowerCase() === "question");
  if (!first || first[1].toLowerCase() !== "what this is" || questions.length !== 1) return null;
  const question = questions[0];
  const next = labels.find((match) => match.index > question.index);
  const request = text.slice(question.index, next?.index ?? text.length).trim();
  const advice = labels.find((match) => match[1].toLowerCase() === "my recommendation");
  const adviceEnd = advice && labels.find((match) => match.index > advice.index);
  const recommendation = advice ? text.slice(advice.index, adviceEnd?.index ?? text.length) : "";
  if (!request || ADVICE_HEDGE.test(recommendation)) return null;
  return request;
}

const SWITCH_REQUEST = /^(?:@?Valentin Yeo )?Question: Switch ([a-z0-9]+(?:-[a-z0-9]+)*) to (Only me|Owner \+ QA|Everyone|Off)\?$/;
const BATCH_SWITCH_REQUEST = /^(?:@?Valentin Yeo )?Question:((?:\s*Switch [a-z0-9]+(?:-[a-z0-9]+)* to (?:Only me|Owner \+ QA|Everyone|Off)\?)+)$/;
const BATCH_SWITCH_ITEM = /Switch ([a-z0-9]+(?:-[a-z0-9]+)*) to (Only me|Owner \+ QA|Everyone|Off)\?/g;

export function strictSwitchRequest(words: string, batchAllowed: boolean, templateAllowed = false): Map<string, string> | null {
  const text = (templateAllowed ? templateQuestionRequest(words) ?? words : words).replace(/\s+/g, " ").trim();
  const single = SWITCH_REQUEST.exec(text);
  if (single) return new Map([[single[1], single[2]]]);
  const batch = batchAllowed ? BATCH_SWITCH_REQUEST.exec(text) : null;
  if (!batch) return null;
  const switches = new Map<string, string>();
  for (const [, key, mode] of batch[1].matchAll(BATCH_SWITCH_ITEM)) {
    if (switches.has(key)) return null;
    switches.set(key, mode);
  }
  return switches;
}

export function parseSwitchQuestion(words: string, templateAllowed = false): Map<string, string> | null {
  const text = templateAllowed ? (templateQuestionRequest(words) ?? words).replace(/^question\s*:\s*/i, "") : words;
  const visible = text.toLowerCase().replace(/"[^"]*(?:"|$)/g, '""');
  const switches = new Map<string, string>();
  const modes: Record<string, string> = {
    "only me": "Only me",
    "owner + qa": "Owner + QA",
    everyone: "Everyone",
    off: "Off",
  };
  const switchClause = /\bswitch\s+([a-z0-9]+(?:-[a-z0-9]+)*)\s+to\s+(only\s+me|owner\s*\+\s*qa|everyone|off)(?![\w-])/g;
  const remainder = text.toLowerCase().replace(switchClause, " ");
  if (/\b(?:if|unless|only|instead|except|but|not|don't|do not|never|no|wait|later|tomorrow|maybe|until)\b/.test(remainder)) return null;
  if (remainder.split(/[.!?\n]/).some((sentence) => /^\s*(?:no|nope|not|don't|do not|never|keep|stop|hold|cancel)\b/.test(sentence))) return null;
  for (const match of visible.matchAll(switchClause)) {
    const prefix = visible.slice(0, match.index).split(/[.!?\n]/).at(-1) ?? "";
    if (/\b(?:not|don't|do not|never|no|didn't|won't|shouldn't)\b/.test(prefix)) return null;
    const key = match[1];
    const mode = modes[match[2].replace(/\s*\+\s*/, " + ").replace(/\s+/g, " ")];
    if (switches.has(key) && switches.get(key) !== mode) return null;
    switches.set(key, mode);
  }
  return switches.size ? switches : null;
}
