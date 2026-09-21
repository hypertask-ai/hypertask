import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { z } from "zod";

import {
  createPromptForTiptapForwardSlash,
  errorMessage,
  normalizeTiptapOutput,
  selectTiptapModel,
  SSE_HEADERS,
} from "@/app/api/ai/_lib/editorAi";
import { getProjectTeamProviderContext } from "@/app/api/ai/_lib/providerGate";
import { isAiFeatureEnabled } from "@/lib/systemModelLadder";
import {
  normalizeDictationTranscriptForSse,
} from "@/lib/dictationSse";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { isGuestUserId } from "@/lib/demo/guestGuard";
import {
  resolveDictationLanguage,
  resolveDictationProvider,
} from "@/lib/dictationProvider";
import { fetchUserPreferenceController } from "@/utils/controllers/users/fetch_preferences";
import {
  DictationAudioTooLargeError,
  MAX_DICTATION_AUDIO_BYTES,
  transcribeAudioFile,
} from "@/lib/services/dictation/transcriptionProviders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const audioTranscriptRequestSchema = z.object({
  audioFile: z.string().min(1),
  improve: z.boolean().optional().default(false),
  projectId: z.coerce.number().int().positive().nullable().optional(),
});

function parseAudioDataUrl(audioFile: string) {
  const base64Audio = audioFile.includes("base64,")
    ? audioFile.split("base64,")[1]
    : audioFile;
  const mediaTypeMatch = /^data:([^;,]+)[;,]/i.exec(audioFile);
  return {
    mediaType: mediaTypeMatch?.[1] || "audio/webm",
    base64: base64Audio.trim().replace(/\n/g, "").replace(/ /g, ""),
  };
}

async function transcribeAudio(
  audioFile: string,
  context: { settings: unknown; teamId: string | null; userId?: number },
) {
  const { mediaType, base64 } = parseAudioDataUrl(audioFile);
  const bytes = Buffer.from(base64, "base64");
  const file = new File([bytes], "audio.webm", { type: mediaType });

  const provider = resolveDictationProvider(context.settings);
  const tags: string[] = [];
  if (context.teamId) tags.push(`team:${context.teamId}`);
  if (context.userId) tags.push(`user:${context.userId}`);

  // Per-user dictation language (cached ~5min). resolveDictationLanguage falls
  // back to English for a missing value or a user with no settings row.
  const prefs = context.userId
    ? await fetchUserPreferenceController(context.userId)
    : null;
  const language = resolveDictationLanguage(
    (prefs?.res as { dictationLanguage?: unknown } | null)?.dictationLanguage,
  );

  return transcribeAudioFile(provider, file, { language, tags });
}

async function improveTranscript(
  transcript: string,
  lookup?: {
    projectId?: number | null;
    userId?: number;
    teamContext?: { teamId: string | null; settings: unknown };
  }
) {
  const selected = await selectTiptapModel(lookup);
  const { text } = await generateText({
    model: selected.model,
    instructions: createPromptForTiptapForwardSlash(
      "ImproveReadability",
      transcript,
    ),
    prompt: `Follow the provided instructions for the following content: ${transcript}`,
    maxRetries: 2,
    providerOptions: selected.providerOptions,
    ...selected.settings,
  });
  return normalizeTiptapOutput(transcript, text);
}

export async function POST(request: NextRequest) {
  const session = await getSessionUser(request.headers);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (await isGuestUserId(session.userId)) {
    return NextResponse.json(
      { error: "Dictation is not available on demo boards" },
      { status: 403 },
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    json = null;
  }

  let body: z.infer<typeof audioTranscriptRequestSchema>;
  try {
    body = audioTranscriptRequestSchema.parse(json);
  } catch (error) {
    return NextResponse.json(
      { error: `Invalid request: ${errorMessage(error)}` },
      { status: 400 }
    );
  }

  const parsedAudio = parseAudioDataUrl(body.audioFile);
  if (Buffer.byteLength(parsedAudio.base64, "base64") > MAX_DICTATION_AUDIO_BYTES) {
    return NextResponse.json(
      { error: "Audio is too large. Record a shorter message and try again." },
      { status: 413 },
    );
  }
  if (!body.projectId) {
    return NextResponse.json({ error: "A board is required" }, { status: 400 });
  }

  try {
    const teamContext = await getProjectTeamProviderContext(
      body.projectId,
      session.userId,
    );
    if (teamContext.projectId !== body.projectId) {
      return NextResponse.json({ error: "Board not found" }, { status: 404 });
    }
    if (!isAiFeatureEnabled("dictation", teamContext.settings)) {
      return NextResponse.json(
        { error: "This AI feature is turned off for your team" },
        { status: 403 },
      );
    }

    const transcript = await transcribeAudio(body.audioFile, {
      settings: teamContext.settings,
      teamId: teamContext.teamId,
      userId: session.userId,
    });

    if (body.improve) {
      const responseHtml = await improveTranscript(transcript, {
        projectId: body.projectId,
        userId: session.userId,
        teamContext,
      });
      return NextResponse.json({ response_html: responseHtml }, { status: 200 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        try {
          // One SSE payload: the client inserts the full transcript in a single
          // editor operation instead of animating word-by-word (HTPR-5691).
          const normalized = normalizeDictationTranscriptForSse(transcript);
          controller.enqueue(encoder.encode(`data: ${normalized}\n\n`));
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              `event: error\ndata: ${JSON.stringify({ content: errorMessage(error) })}\n\n`,
            ),
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, { headers: SSE_HEADERS });
  } catch (error) {
    if (error instanceof DictationAudioTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    console.error("[ai/audio-transcript] error", error);
    if (body.improve) {
      return NextResponse.json({ error: String(errorMessage(error)) }, { status: 500 });
    }
    return NextResponse.json({ error: String(errorMessage(error)) }, { status: 500 });
  }
}
