import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import {
  DisplayAvatar,
  MentionPreference,
  ScrollSetting,
} from "@prisma/client";
import {
  fetchUserPreferenceController,
  invalidateUserPreferenceCache,
} from "@/utils/controllers/users/fetch_preferences";
import {
  mergeAiModelPreferenceUpdates,
  isAiModelPreferenceSurface,
  type TAiModelPreferences,
  type TAiModelPreferencesBySurface,
} from "@/lib/aiModelPreferences";
import {
  aiImageModelDefinitions,
  getAiModelOptionById,
} from "@/lib/aiModelOptions";
import { sanitizeRichHtml } from "@/utils/helperFunctions/sanitizeRichHtml";
import { isDictationLanguage } from "@/lib/dictationProvider";
import { isAllTasksDateRange } from "@/lib/configs/allTasks.config";
import type { ISnippet } from "@/lib/snippets";
import type { Prisma } from "@prisma/client";
import {
  applyCalendarViewsOperation,
  DEFAULT_CALENDAR_VIEWS,
  isCalendarViewsOperation,
  sanitizeCalendarViewsPreference,
  type CalendarViewsOperation,
} from "@/models/Calendar/model";

export const runtime = "nodejs";

const MAX_CALENDAR_VIEW_WRITE_ATTEMPTS = 3;

class InvalidCalendarViewsOperationError extends Error {}

async function getCurrentUserFromCookies() {
  try {
    const cookieStore = await cookies();
    const userCookie = cookieStore.get("nookies_user");
    if (!userCookie?.value) return null;
    return JSON.parse(userCookie.value) as { id?: number };
  } catch (error: any) {
    console.log("🚀 ~ getCurrentUserFromCookies ~ error:", error);
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUserFromCookies();
    if (!user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const response = await fetchUserPreferenceController(user.id);
    return NextResponse.json(
      {
        success: true,
        settings: { ...response.res },
      },
      { status: response.status },
    );
  } catch (error) {
    console.log("🚀 ~ GET [users/preferences] ~ error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
        settings: {
          displayAvatar: "Hidden",
          commentsStacked: false,
          shareReadReceipts: false,
          scrollSetting: "Bottom",
          notification: false,
          notificationPreference: "direct",
          aiModelPreferences: null,
          snippets: [],
          muteAnnouncements: false,
          playGifs: true,
          autoDescriptionSuggestions: true,
          dictationLanguage: "en",
          inboxAdvanceOnSend: true,
          emojiFrequency: null,
          calendarViews: null,
        },
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUserFromCookies();
    if (!user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON" },
        { status: 400 },
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, error: "Invalid preferences" },
        { status: 400 },
      );
    }

    let calendarViewsOperation: CalendarViewsOperation | undefined;
    if (body.calendarViews !== undefined) {
      return NextResponse.json(
        { success: false, error: "Invalid calendar views" },
        { status: 400 },
      );
    }
    if (body.calendarViewsOperation !== undefined) {
      if (!isCalendarViewsOperation(body.calendarViewsOperation)) {
        return NextResponse.json(
          { success: false, error: "Invalid calendar view operation" },
          { status: 400 },
        );
      }
      calendarViewsOperation = body.calendarViewsOperation;
    }

    const data: {
      displayAvatar?: DisplayAvatar;
      commentsStacked?: boolean;
      shareReadReceipts?: boolean;
      scrollSetting?: ScrollSetting;
      notification?: boolean;
      notificationPreference?: MentionPreference;
      aiModelPreferences?: Prisma.InputJsonValue;
      snippets?: ISnippet[];
      muteAnnouncements?: boolean;
      playGifs?: boolean;
      autoDescriptionSuggestions?: boolean;
      dictationLanguage?: string;
      inboxAdvanceOnSend?: boolean;
      emojiFrequency?: Prisma.InputJsonValue;
      allTasksDateRange?: string;
    } = {};

    if (body.displayAvatar !== undefined) {
      data.displayAvatar = body.displayAvatar as DisplayAvatar;
    }
    if (body.commentsStacked !== undefined) {
      data.commentsStacked = body.commentsStacked as boolean;
    }
    if (body.shareReadReceipts !== undefined) {
      if (typeof body.shareReadReceipts !== "boolean") {
        return NextResponse.json(
          { success: false, error: "Invalid read receipts preference" },
          { status: 400 },
        );
      }
      data.shareReadReceipts = body.shareReadReceipts;
    }
    if (body.scrollSetting !== undefined) {
      data.scrollSetting = body.scrollSetting as ScrollSetting;
    }
    if (body.notification !== undefined) {
      data.notification = body.notification as boolean;
    }
    if (body.muteAnnouncements !== undefined) {
      data.muteAnnouncements = body.muteAnnouncements as boolean;
    }
    if (body.playGifs !== undefined) {
      data.playGifs = body.playGifs as boolean;
    }
    if (body.autoDescriptionSuggestions !== undefined) {
      if (typeof body.autoDescriptionSuggestions !== "boolean") {
        return NextResponse.json(
          { success: false, error: "Invalid description suggestion preference" },
          { status: 400 },
        );
      }
      data.autoDescriptionSuggestions = body.autoDescriptionSuggestions;
    }
    if (body.inboxAdvanceOnSend !== undefined) {
      data.inboxAdvanceOnSend = body.inboxAdvanceOnSend as boolean;
    }
    if (body.allTasksDateRange !== undefined) {
      if (!isAllTasksDateRange(body.allTasksDateRange)) {
        return NextResponse.json(
          { success: false, error: "Invalid date range" },
          { status: 400 },
        );
      }
      data.allTasksDateRange = body.allTasksDateRange;
    }
    if (body.dictationLanguage !== undefined) {
      if (!isDictationLanguage(body.dictationLanguage)) {
        return NextResponse.json(
          { success: false, error: "Invalid dictation language" },
          { status: 400 },
        );
      }
      data.dictationLanguage = body.dictationLanguage;
    }
    if (body.notificationPreference !== undefined) {
      data.notificationPreference =
        body.notificationPreference as MentionPreference;
    }

    if (body.aiModelPreferences !== undefined) {
      if (
        !body.aiModelPreferences ||
        typeof body.aiModelPreferences !== "object" ||
        Array.isArray(body.aiModelPreferences)
      ) {
        return NextResponse.json(
          { success: false, error: "Invalid AI model preferences" },
          { status: 400 },
        );
      }

      const preferenceUpdates = Object.entries(body.aiModelPreferences);
      const invalidPreference = preferenceUpdates.find(
        ([surface, optionId]) =>
          !isAiModelPreferenceSurface(surface) ||
          typeof optionId !== "string" ||
          (surface === "imageGeneration"
            ? !aiImageModelDefinitions.some((model) => model.key === optionId)
            : !getAiModelOptionById(optionId)),
      );

      if (invalidPreference) {
        return NextResponse.json(
          { success: false, error: "Invalid AI model preference" },
          { status: 400 },
        );
      }

      const teamId = body.aiModelPreferencesTeamId;
      if (
        teamId !== undefined &&
        ((typeof teamId !== "string" && typeof teamId !== "number") ||
          !String(teamId).trim())
      ) {
        return NextResponse.json(
          { success: false, error: "Invalid AI model preference team" },
          { status: 400 },
        );
      }

      const existing = await prisma.userSetting.findUnique({
        where: { userId: user.id },
        select: { aiModelPreferences: true },
      });
      data.aiModelPreferences = mergeAiModelPreferenceUpdates(
        existing?.aiModelPreferences as TAiModelPreferences | null | undefined,
        Object.fromEntries(
          preferenceUpdates as [string, string][],
        ) as TAiModelPreferencesBySurface,
        teamId as string | number | undefined,
      ) as Prisma.InputJsonValue;
    }

    if (body.snippets !== undefined) {
      if (!Array.isArray(body.snippets) || body.snippets.length > 200) {
        return NextResponse.json(
          { success: false, error: "Invalid snippets" },
          { status: 400 },
        );
      }

      const ids = new Set<string>();
      let totalContentLength = 0;
      const snippets: ISnippet[] = [];

      for (const value of body.snippets) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return NextResponse.json(
            { success: false, error: "Invalid snippet" },
            { status: 400 },
          );
        }

        const snippet = value as Record<string, unknown>;
        const title = typeof snippet.title === "string" ? snippet.title.trim() : "";
        const content = typeof snippet.content === "string" ? snippet.content : "";
        const createdAt =
          typeof snippet.createdAt === "string" ? new Date(snippet.createdAt) : null;

        if (
          typeof snippet.id !== "string" ||
          snippet.id.length < 1 ||
          snippet.id.length > 100 ||
          ids.has(snippet.id) ||
          !title ||
          title.length > 120 ||
          !content ||
          content.length > 100_000 ||
          !createdAt ||
          Number.isNaN(createdAt.getTime())
        ) {
          return NextResponse.json(
            { success: false, error: "Invalid snippet" },
            { status: 400 },
          );
        }

        const sanitizedContent = sanitizeRichHtml(content);
        const hasContent =
          sanitizedContent.replace(/<[^>]*>/g, "").trim().length > 0 ||
          /<(img|hr)\b/i.test(sanitizedContent);
        totalContentLength += sanitizedContent.length;

        if (!hasContent || totalContentLength > 2_000_000) {
          return NextResponse.json(
            { success: false, error: "Invalid snippet content" },
            { status: 400 },
          );
        }

        ids.add(snippet.id);
        snippets.push({
          id: snippet.id,
          title,
          content: sanitizedContent,
          createdAt: createdAt.toISOString(),
        });
      }

      data.snippets = snippets;
    }

    if (body.emojiFrequency !== undefined) {
      const map = body.emojiFrequency;
      if (!map || typeof map !== "object" || Array.isArray(map)) {
        return NextResponse.json(
          { success: false, error: "Invalid emoji frequency" },
          { status: 400 },
        );
      }
      const entries = Object.entries(map as Record<string, unknown>);
      if (entries.length > 200) {
        return NextResponse.json(
          { success: false, error: "Invalid emoji frequency" },
          { status: 400 },
        );
      }
      for (const [key, value] of entries) {
        if (
          typeof key !== "string" ||
          key.length < 1 ||
          key.length > 100 ||
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          value < 0
        ) {
          return NextResponse.json(
            { success: false, error: "Invalid emoji frequency" },
            { status: 400 },
          );
        }
      }
      // Merge (max per emoji) into the stored map rather than replacing it, so
      // a second device or a stale emoji-mart Index can never shrink the saved
      // history. Mirrors the aiModelPreferences merge-on-write pattern above.
      const existing = await prisma.userSetting.findUnique({
        where: { userId: user.id },
        select: { emojiFrequency: true },
      });
      const prev =
        existing?.emojiFrequency &&
        typeof existing.emojiFrequency === "object" &&
        !Array.isArray(existing.emojiFrequency)
          ? (existing.emojiFrequency as Record<string, number>)
          : {};
      const merged: Record<string, number> = { ...prev };
      for (const [key, value] of entries) {
        const current = typeof merged[key] === "number" ? merged[key] : 0;
        merged[key] = Math.max(current, value as number);
      }
      // Keep only the 200 highest-count emojis so the map stays bounded.
      let capped: Record<string, number> = merged;
      const mergedKeys = Object.keys(merged);
      if (mergedKeys.length > 200) {
        capped = Object.fromEntries(
          mergedKeys
            .sort((a, b) => merged[b] - merged[a])
            .slice(0, 200)
            .map((key) => [key, merged[key]]),
        );
      }
      data.emojiFrequency = capped as Prisma.InputJsonValue;
    }

    const select = {
      displayAvatar: true,
      commentsStacked: true,
      shareReadReceipts: true,
      scrollSetting: true,
      notification: true,
      notificationPreference: true,
      aiModelPreferences: true,
      snippets: true,
      muteAnnouncements: true,
      playGifs: true,
      autoDescriptionSuggestions: true,
      dictationLanguage: true,
      inboxAdvanceOnSend: true,
      emojiFrequency: true,
      calendarViews: true,
      allTasksDateRange: true,
    } as const;
    const updateWithCalendarOperation = async () => {
      for (
        let attempt = 0;
        attempt < MAX_CALENDAR_VIEW_WRITE_ATTEMPTS;
        attempt += 1
      ) {
        try {
          return await prisma.$transaction(
            async (tx) => {
              const existing = await tx.userSetting.findUnique({
                where: { userId: user.id },
                select: { calendarViews: true },
              });
              const current =
                sanitizeCalendarViewsPreference(existing?.calendarViews) ??
                DEFAULT_CALENDAR_VIEWS;
              const next = applyCalendarViewsOperation(
                current,
                calendarViewsOperation!,
              );
              if (!next) {
                throw new InvalidCalendarViewsOperationError();
              }

              return tx.userSetting.update({
                where: { userId: user.id },
                data: {
                  ...data,
                  calendarViews: next as Prisma.InputJsonValue,
                },
                select,
              });
            },
            { isolationLevel: "Serializable" },
          );
        } catch (error: any) {
          if (
            error?.code !== "P2034" ||
            attempt === MAX_CALENDAR_VIEW_WRITE_ATTEMPTS - 1
          ) {
            throw error;
          }
        }
      }
      throw new Error("Unable to save calendar views");
    };
    const result = calendarViewsOperation
      ? await updateWithCalendarOperation()
      : await prisma.userSetting.update({
          where: { userId: user.id },
          data,
          select,
        });

    await invalidateUserPreferenceCache(user.id);

    return NextResponse.json({
      success: true,
      settings: { ...result },
    });
  } catch (error) {
    if (error instanceof InvalidCalendarViewsOperationError) {
      return NextResponse.json(
        { success: false, error: "Invalid calendar view operation" },
        { status: 400 },
      );
    }
    console.log("🚀 ~ POST [users/preferences] ~ error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

export const PATCH = POST;
