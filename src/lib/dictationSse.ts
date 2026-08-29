/** Collapse provider whitespace so SSE framing cannot drop part of the transcript. */
export function normalizeDictationTranscriptForSse(transcript: string): string {
  return transcript.replace(/\s+/g, " ").trim();
}

/** Collect transcript text from SSE chunks before a single editor insert. */
export function collectDictationTranscriptFromSse(chunks: string[]): string {
  let pending = "";
  let transcript = "";
  for (const chunk of chunks) {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        transcript += line.slice(6);
      }
    }
  }
  if (pending.startsWith("data: ")) {
    transcript += pending.slice(6);
  }
  return transcript.trim();
}
