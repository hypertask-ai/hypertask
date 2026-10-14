import { dictationConfig } from "@/lib/configs/dictation.config";
import { MAX_DICTATION_AUDIO_BYTES } from "@/lib/dictationLimits";

export { MAX_DICTATION_AUDIO_BYTES } from "@/lib/dictationLimits";


export type TranscribeOptions = {
  language?: string;
  tags?: string[];
};

export class DictationAudioTooLargeError extends Error {
  constructor() {
    super("Audio is too large. Record a shorter message and try again.");
    this.name = "DictationAudioTooLargeError";
  }
}

function sanitizeTag(tag: string): string {
  return tag.trim().slice(0, 128);
}

export async function transcribeWithDeepgram(
  audioFile: File,
  options: TranscribeOptions = {},
): Promise<string> {
  if (audioFile.size > MAX_DICTATION_AUDIO_BYTES) {
    throw new DictationAudioTooLargeError();
  }

  const apiKey =
    process.env.DEEPGRAM_API_KEY || dictationConfig.api.deepgram.apiKey;
  if (!apiKey) {
    throw new Error("Deepgram API key not configured");
  }

  const params = new URLSearchParams({
    model: dictationConfig.api.deepgram.model,
    smart_format: "true",
    punctuate: "true",
  });

  const language = options.language ?? dictationConfig.api.deepgram.language;
  if (language) params.set("language", language);

  for (const tag of options.tags ?? []) {
    const clean = sanitizeTag(tag);
    if (clean) params.append("tag", clean);
  }

  const buffer = await audioFile.arrayBuffer();
  const response = await fetch(
    `${dictationConfig.api.deepgram.endpoint}?${params.toString()}`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": audioFile.type || "audio/webm",
      },
      body: buffer,
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    let message = `Deepgram error: ${response.status}`;
    try {
      const parsed = JSON.parse(errorText);
      message = parsed.err_msg || parsed.error || message;
    } catch {
      if (errorText) message = errorText;
    }
    throw new Error(message);
  }

  const result = await response.json();
  const transcript =
    result?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  return String(transcript ?? "").trim();
}

export async function transcribeAudioFile(
  _provider: "deepgram",
  audioFile: File,
  options: TranscribeOptions = {},
): Promise<string> {
  return transcribeWithDeepgram(audioFile, options);
}
