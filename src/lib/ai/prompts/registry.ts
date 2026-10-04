import { PROMPTS } from "./definitions";

export { PROMPTS };
export type PromptId = keyof typeof PROMPTS;

export function renderPrompt(id: PromptId, ...values: unknown[]): string {
  const { parts } = PROMPTS[id];
  if (values.length !== parts.length - 1) {
    throw new Error(`Incorrect interpolation count for prompt ${id}`);
  }
  return parts.reduce<string>((text, part, index) =>
    text + (index ? String(values[index - 1]) : "") + part, "");
}

const anchors = Object.values(PROMPTS)
  .map((prompt) => ({
    id: prompt.id,
    version: prompt.version,
    anchor: [...prompt.parts].sort((a, b) => b.length - a.length)[0],
  }))
  .sort((a, b) => {
    const fragment = (id: string) => /(?:-style|-skill|-rule|-rules)$/.test(id);
    return Number(fragment(a.id)) - Number(fragment(b.id)) || b.anchor.length - a.anchor.length;
  });

export function identifyPrompt(prompt: unknown): { promptId: string; promptVersion: string } {
  const messages = Array.isArray(prompt) ? prompt : [];
  const systemMessages = messages.filter((message) => message?.role === "system");
  const text = (systemMessages.length ? systemMessages : messages).flatMap((message) => {
    if (!message || typeof message !== "object") return [];
    if (typeof message.content === "string") return [message.content];
    if (!Array.isArray(message.content)) return [];
    return message.content.flatMap((part: { type?: string; text?: string }) =>
      part?.type === "text" && typeof part.text === "string" ? [part.text] : []);
  });
  const matched = anchors.find(({ anchor }) => anchor.length >= 60 && text.some((value) => value.includes(anchor)));
  return matched
    ? { promptId: matched.id, promptVersion: matched.version }
    : { promptId: "dynamic-input", promptVersion: "1" };
}
