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

export function parseSwitchQuestion(text: string): Map<string, string> | null {
  const visible = text.toLowerCase().replace(/"[^"]*(?:"|$)/g, '""');
  const switches = new Map<string, string>();
  const modes: Record<string, string> = {
    "only me": "Only me",
    "owner + qa": "Owner + QA",
    everyone: "Everyone",
    off: "Off",
  };
  for (const match of visible.matchAll(/\bswitch\s+([a-z0-9]+(?:-[a-z0-9]+)*)\s+to\s+(only\s+me|owner\s*\+\s*qa|everyone|off)(?![\w-])/g)) {
    const prefix = visible.slice(0, match.index).split(/[.!?\n]/).at(-1) ?? "";
    if (/\b(?:not|don't|do not|never|no|didn't|won't|shouldn't)\b/.test(prefix)) return null;
    const key = match[1];
    const mode = modes[match[2].replace(/\s*\+\s*/, " + ").replace(/\s+/g, " ")];
    if (switches.has(key) && switches.get(key) !== mode) return null;
    switches.set(key, mode);
  }
  return switches.size ? switches : null;
}
