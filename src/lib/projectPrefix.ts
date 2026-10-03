import { getSequentialLetters } from "@/utils/helperFunctions/helperFunctions";

export function normalizeProjectPrefix(input: unknown): string {
  const prefix = typeof input === "string" ? input.trim().toUpperCase() : "";
  if (!/^[A-Z][A-Z0-9]{1,4}$/.test(prefix)) {
    throw new Error("Ticket prefix must be 2 to 5 letters or numbers and start with a letter");
  }
  return prefix;
}

export function suggestProjectPrefix(title: string): string {
  const raw = getSequentialLetters(title);
  let base = /^[A-Z0-9]{2,5}$/.test(raw)
    ? raw
    : (title.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 4) || "BRD");
  if (!/^[A-Z]/.test(base)) base = `B${base.slice(0, 4)}`;
  return base.padEnd(2, "B");
}
