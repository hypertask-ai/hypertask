import { NextRequest, NextResponse } from "next/server";
import { generateImage, generateText } from "ai";
import { z } from "zod";

import { htmlToText } from "@/app/api/ai/_lib/currentTaskContext";
import { getTeamGatewayApiKey } from "@/app/api/ai/_lib/byokKeys";
import { sharedAiAllowanceErrorMessage } from "@/app/api/ai/_lib/sharedAllowance";
import {
  errorMessage,
  getCurrentUserFromCookies,
} from "@/app/api/ai/_lib/editorAi";
import {
  gatewayProviderOptionsForModel,
  resolveGatewayImageModel,
  resolveGatewayModel,
} from "@/app/api/ai/_lib/modelProvider";
import { assertImageModelAllowedForPlan } from "@/app/api/ai/_lib/planGate";
import { getProjectTeamProviderContext } from "@/app/api/ai/_lib/providerGate";
import { resolveTeamProviderEnabled } from "@/lib/aiProviders";
import { resolveAiImageModelMention } from "@/lib/aiModelOptions";
import {
  isAiFeatureEnabled,
  resolveImageModel,
} from "@/lib/systemModelLadder";
import {
  getAiModelPreferenceIds,
  type TAiModelPreferences,
} from "@/lib/aiModelPreferences";
import prisma from "@/lib/prisma";
import { uploadTaskAttachmentToS3 } from "@/lib/storage/uploadTaskAttachmentToS3";
import { createCommentService } from "@/utils/controllers/comments/createCommentService";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { fetchUserPreferenceController } from "@/utils/controllers/users/fetch_preferences";
import addIntoTask from "@/utils/controllers/urls/addIntoTask";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const generateImageRequestSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  taskId: z.coerce.number().int().positive(),
  text: z.string().min(1),
  modelKey: z.string().min(1).optional(),
});

export async function POST(request: NextRequest) {
  const cookieUser = await getCurrentUserFromCookies();
  if (!cookieUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = generateImageRequestSchema.parse(await request.json());
    const [task, botUser, teamContext, userPreferences] = await Promise.all([
      prisma.task.findFirst({
        where: {
          id: body.taskId,
          projectId: body.projectId,
          deletedAt: null,
          project: taskWriteAccessWhere(cookieUser.id),
        },
        select: { userId: true },
      }),
      prisma.user.findUnique({
        where: {
          id: parseInt(process.env.NEXT_PUBLIC_HYPERAI_ID || "332", 10),
        },
      }),
      getProjectTeamProviderContext(body.projectId, cookieUser.id),
      fetchUserPreferenceController(cookieUser.id),
    ]);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    if (teamContext.projectId !== body.projectId) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    if (!botUser) throw new Error("HyperAI user not found");
    if (!isAiFeatureEnabled("imageGeneration", teamContext.settings)) {
      return NextResponse.json(
        { error: "This AI feature is turned off for your team" },
        { status: 403 },
      );
    }

    // Precedence: explicit request override → user's "Default models" image
    // preference (team-scoped, then global) → team's system image ladder.
    const preferenceIds = getAiModelPreferenceIds(
      userPreferences.res.aiModelPreferences as
        | TAiModelPreferences
        | null
        | undefined,
      "imageGeneration",
      teamContext.teamId,
    );
    const preferredModelKey =
      body.modelKey ?? preferenceIds.teamScoped ?? preferenceIds.global;
    const definition =
      (preferredModelKey
        ? resolveAiImageModelMention(preferredModelKey)
        : null) ?? resolveImageModel(teamContext.settings);
    const prompt = htmlToText(body.text).trim() || body.text;
    let generated:
      | { mediaType: string; fileName: string; imageUrl: string }
      | undefined;

    try {
      if (!definition) throw new Error("Unknown image model");
      if (
        !resolveTeamProviderEnabled(teamContext.settings, definition.provider)
      ) {
        throw new Error("Image model provider is unavailable");
      }

      const gatewayApiKey = await getTeamGatewayApiKey({
        trustedTeamId: teamContext.teamId,
      });
      await assertImageModelAllowedForPlan(
        body.projectId,
        definition,
        gatewayApiKey,
      );
      const tags = {
        teamId: teamContext.teamId,
        projectId: body.projectId,
        userId: cookieUser.id,
      };
      const image =
        definition.generation === "language"
          ? await generateWithLanguageModel(
              definition.gatewayModel,
              prompt,
              gatewayApiKey,
              tags
            )
          : await generateWithImageModel(
              definition.gatewayModel,
              prompt,
              gatewayApiKey,
              tags
            );
      const extension = extensionForMediaType(image.mediaType);
      const fileName = `hyperai-image-${Date.now()}.${extension}`;
      const buffer = Buffer.from(image.base64, "base64");
      const imageUrl = await uploadTaskAttachmentToS3(
        buffer,
        fileName,
        image.mediaType
      );
      generated = { mediaType: image.mediaType, fileName, imageUrl };
    } catch (error) {
      const allowanceMessage = sharedAiAllowanceErrorMessage(error);
      if (allowanceMessage) {
        return NextResponse.json(
          { error: allowanceMessage },
          { status: 429 },
        );
      }
      console.error("[ai/generate-image] unavailable:", error);
    }

    const requesterName = cookieUser.displayName || "User";
    const modelLabel =
      definition?.label ?? body.modelKey ?? preferredModelKey ?? "Image model";
    const imageHtml = generated
      ? `<p><img src="${generated.imageUrl}" media-type="img" width="auto" height="320" dataalign="left" loading="lazy" style="height: 320px; width: auto"></p>`
      : "<p>Image generation is unavailable on this plan.</p>";
    const commentText =
      `<p><span data-type="mention" class="mention" data-id="${escapeHtml(requesterName)}" data-label="name-${cookieUser.id}" uniqueindex="" projectid="">${escapeHtml(requesterName)}</span> said</p>` +
      `<blockquote>${escapeHtml(prompt)}</blockquote>` +
      imageHtml +
      `<p><em>— ${escapeHtml(modelLabel)}</em></p>`;
    const comment = await createCommentService({
      text: commentText,
      creatorId: botUser.id,
      taskId: body.taskId,
      ownerId: task.userId,
      currentUser: botUser,
      accessUserId: cookieUser.id,
    });

    if (generated) {
      await addIntoTask(
        [
          {
            TaskId: body.taskId,
            urlString: generated.imageUrl,
            title: generated.fileName,
            Attachment: true,
            attachmentType: generated.mediaType,
          },
        ],
        comment.id,
        "POST"
      );
    }

    return NextResponse.json(
      {
        success: true,
        imageUrl: generated?.imageUrl,
        unavailable: !generated,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[ai/generate-image] error:", error);
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500 }
    );
  }
}

async function generateWithLanguageModel(
  modelId: string,
  prompt: string,
  gatewayApiKey: string | undefined,
  tags: { teamId?: string | null; projectId?: number | null; userId?: number | null }
) {
  const model = resolveGatewayModel(modelId, gatewayApiKey);
  const result = await generateText({
    model,
    prompt,
    maxRetries: 2,
    providerOptions: gatewayProviderOptionsForModel(
      model,
      "generate-image",
      tags
    ),
  });
  const image = result.files.find((file) => file.mediaType.startsWith("image/"));
  if (!image) throw new Error("Image model returned no image");
  return image;
}

async function generateWithImageModel(
  modelId: string,
  prompt: string,
  gatewayApiKey: string | undefined,
  tags: { teamId?: string | null; projectId?: number | null; userId?: number | null }
) {
  const model = resolveGatewayImageModel(modelId, gatewayApiKey);
  const result = await generateImage({
    model,
    prompt,
    n: 1,
    maxRetries: 2,
    providerOptions: gatewayProviderOptionsForModel(
      model,
      "generate-image",
      tags
    ),
  });
  return result.image;
}

function extensionForMediaType(mediaType: string) {
  if (mediaType.includes("jpeg") || mediaType.includes("jpg")) return "jpg";
  if (mediaType.includes("webp")) return "webp";
  if (mediaType.includes("gif")) return "gif";
  return "png";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
