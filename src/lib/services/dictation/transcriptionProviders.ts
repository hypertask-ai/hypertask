import { logAiUsage } from "@/app/api/ai/_lib/aiUsage";
import { dictationConfig } from "@/lib/configs/dictation.config";
import { MAX_DICTATION_AUDIO_BYTES } from "@/lib/dictationLimits";
import { dictationAuthorization, resolveTeamAiFunding } from "@/lib/ai/teamAiFunding";

export { MAX_DICTATION_AUDIO_BYTES } from "@/lib/dictationLimits";


export type TranscribeOptions = {
  language?: string;
  tags?: string[];
  usage?: { userId: number; teamId: string | null; projectId: number };
  teamId?: string | null;
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

  const decision = options.teamId
    ? await resolveTeamAiFunding(options.teamId, { provider: "deepgram", feature: "dictation" })
    : { mode: "unrestricted" as const };
  const apiKey = dictationAuthorization(
    decision,
    process.env.DEEPGRAM_API_KEY || dictationConfig.api.deepgram.apiKey,
  );

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
  const startedAt = Date.now();
  let succeeded = false;
  try {
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
    succeeded = true;
    return String(transcript ?? "").trim();
  } finally {
    await logAiUsage({
      ...options.usage,
      userId: options.usage?.userId ?? null,
      provider: "deepgram",
      model: dictationConfig.api.deepgram.model,
      feature: "dictation",
      outcome: succeeded ? "ok" : "failed",
      costUsd: null,
      latencyMs: Date.now() - startedAt,
    });
  }
}

export async function transcribeAudioFile(
  _provider: "deepgram",
  audioFile: File,
  options: TranscribeOptions = {},
): Promise<string> {
  return transcribeWithDeepgram(audioFile, options);
}
