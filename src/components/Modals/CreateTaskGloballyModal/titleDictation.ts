export function appendTitleDictation(current: string, dictated: string): string {
  const transcript = dictated.trim();
  if (!transcript) return current;
  if (!current) return transcript;
  return /\s$/u.test(current) ? current + transcript : current + " " + transcript;
}
