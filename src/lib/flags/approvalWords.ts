import { parse } from "node-html-parser";

export const FLAG_CHAT_RECORD_AGENT_ID = "9b0f3a93-5e88-4093-b558-cad1c229bc51";

export function normalizeVisibleText(html: string): string {
  return parse(html).text.normalize("NFKC")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

export { classifyAnswer } from "../../../../.claude/skills/ship/scripts/approval-answer.cjs";

const SWITCH_REQUEST = /^(?:@?Valentin Yeo )?Question: Switch ([a-z0-9]+(?:-[a-z0-9]+)*) to (Only me|Owner \+ QA|Everyone|Off)\?$/;
const BATCH_SWITCH_REQUEST = /^(?:@?Valentin Yeo )?Question:((?:\s*Switch [a-z0-9]+(?:-[a-z0-9]+)* to (?:Only me|Owner \+ QA|Everyone|Off)\?)+)$/;
const BATCH_SWITCH_ITEM = /Switch ([a-z0-9]+(?:-[a-z0-9]+)*) to (Only me|Owner \+ QA|Everyone|Off)\?/g;

export function strictSwitchRequest(words: string, batchAllowed: boolean): Map<string, string> | null {
  const text = words.replace(/\s+/g, " ").trim();
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

export function parseSwitchQuestion(text: string): Map<string, string> | null {
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
