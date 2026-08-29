import { NextRequest, NextResponse } from "next/server";
import { getProjectTeamProviderContext } from "@/app/api/ai/_lib/providerGate";
import { isAiFeatureEnabled } from "@/lib/systemModelLadder";
import {
  resolveDictationLanguage,
  resolveDictationProvider,
} from "@/lib/dictationProvider";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { isGuestUserId } from "@/lib/demo/guestGuard";
import { fetchUserPreferenceController } from "@/utils/controllers/users/fetch_preferences";
import {
  DictationAudioTooLargeError,
  MAX_DICTATION_AUDIO_BYTES,
  transcribeAudioFile,
} from "@/lib/services/dictation/transcriptionProviders";

/**
 * /api/dictation/transcribe - Server-side API endpoint for transcription
 *
 * ROLE IN SYSTEM:
 * Receives complete audio files from clients and forwards them to
 * Deepgram. Returns the text.
 *
 * FLOW:
 * 1. The client POSTs FormData: `audio` (file) + required `projectId`.
 * 2. Resolve the authenticated user and the project's team settings.
 * 3. Gate on the team's "dictation" AI-feature toggle.
 * 4. Pick the provider from team settings and forward the audio, attaching
 *    `team:<id>` / `user:<id>` tags so Deepgram usage is attributable per
 *    customer in its dashboard.
 * 5. Return the transcribed text as JSON: { text: "..." }
 *
 * FILTERING:
 * - Rejects files < 5KB (likely empty/silent)
 * - Filters transcriptions < 3 characters (likely noise)
 */
export async function POST(request: NextRequest) {
  try {
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

    const formData = await request.formData();
    const audioFile = formData.get("audio") as File;

    if (!audioFile || audioFile.size < 5000) {
      return NextResponse.json({ text: "" }, { status: 200 });
    }
    if (audioFile.size > MAX_DICTATION_AUDIO_BYTES) {
      return NextResponse.json(
        { error: "Audio is too large. Record a shorter message and try again." },
        { status: 413 },
      );
    }

    const rawProjectId = formData.get("projectId");
    const projectId =
      typeof rawProjectId === "string" && rawProjectId.trim()
        ? Number(rawProjectId)
        : null;
    if (!Number.isInteger(projectId) || Number(projectId) <= 0) {
      return NextResponse.json({ error: "A board is required" }, { status: 400 });
    }

    const userId = session.userId;

    const teamContext = await getProjectTeamProviderContext(
      projectId,
      userId,
    );
    if (teamContext.projectId !== projectId) {
      return NextResponse.json({ error: "Board not found" }, { status: 404 });
    }

    // Respect the team's dictation toggle (parity with /api/ai/audio-transcript).
    if (!isAiFeatureEnabled("dictation", teamContext.settings)) {
      return NextResponse.json(
        { error: "This AI feature is turned off for your team" },
        { status: 403 },
      );
    }

    const provider = resolveDictationProvider(teamContext.settings);

    // Usage-attribution tags for Deepgram.
    const tags: string[] = [];
    if (teamContext.teamId) tags.push(`team:${teamContext.teamId}`);
    if (userId) tags.push(`user:${userId}`);

    // Per-user dictation language (cached ~5min); English for missing/no settings.
    const prefs = userId ? await fetchUserPreferenceController(userId) : null;
    const language = resolveDictationLanguage(
      (prefs?.res as { dictationLanguage?: unknown } | null)?.dictationLanguage,
    );

    const startTime = Date.now();
    const text = await transcribeAudioFile(provider, audioFile, {
      language,
      tags,
    });
    const duration = Date.now() - startTime;
    console.log(
      `[Dictation:${provider}] Request took ${duration}ms (${(
        duration / 1000
      ).toFixed(2)}s) - Audio size: ${audioFile.size} bytes`,
    );

    // Filter out very short transcriptions (likely noise)
    if (text.length < 3) {
      return NextResponse.json({ text: "" }, { status: 200 });
    }

    return NextResponse.json({ text }, { status: 200 });
  } catch (error) {
    if (error instanceof DictationAudioTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    console.error("Transcription error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Transcription failed" },
      { status: 500 },
    );
  }
}
