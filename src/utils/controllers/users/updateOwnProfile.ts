import prisma from "@/lib/prisma";

export type OwnProfileUpdate = {
  displayName?: string;
  photoURL?: string;
};

export class ProfileValidationError extends Error {
  constructor(
    message: string,
    readonly field: "body" | "displayName" | "photoURL",
    readonly code:
      | "no_fields_provided"
      | "invalid_value"
      | "max_length_exceeded"
      | "invalid_url"
  ) {
    super(message);
    this.name = "ProfileValidationError";
  }
}

function httpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeOwnProfileUpdate(
  input: OwnProfileUpdate
): OwnProfileUpdate {
  let displayName: string | undefined;
  if (input.displayName !== undefined && input.displayName !== "") {
    displayName = input.displayName.trim();
    if (!displayName) {
      throw new ProfileValidationError(
        "displayName must be a non-empty string",
        "displayName",
        "invalid_value"
      );
    }
    if (displayName.length > 100) {
      throw new ProfileValidationError(
        "displayName must not exceed 100 characters",
        "displayName",
        "max_length_exceeded"
      );
    }
    if (/[<>]/.test(displayName)) {
      throw new ProfileValidationError(
        "displayName must not contain < or > characters",
        "displayName",
        "invalid_value"
      );
    }
  }

  let photoURL: string | undefined;
  if (input.photoURL !== undefined && input.photoURL !== "") {
    photoURL = input.photoURL.trim();
    if (!photoURL) {
      throw new ProfileValidationError(
        "photoURL must be a non-empty string",
        "photoURL",
        "invalid_value"
      );
    }
    if (!httpUrl(photoURL)) {
      throw new ProfileValidationError(
        "photoURL must be a valid http(s) URL",
        "photoURL",
        "invalid_url"
      );
    }
  }

  if (displayName === undefined && photoURL === undefined) {
    throw new ProfileValidationError(
      "At least one of displayName or photoURL must be provided",
      "body",
      "no_fields_provided"
    );
  }

  return { displayName, photoURL };
}

/**
 * Updates the signed-in human profile and the matching explicit-set flags in
 * one transaction. MCP and native AI Chat both use this write path.
 */
export async function updateOwnProfile(
  userId: number,
  input: OwnProfileUpdate
) {
  const { displayName, photoURL } = normalizeOwnProfileUpdate(input);
  const existingUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { displayName: true, photoURL: true },
  });
  if (!existingUser) return null;

  return prisma.$transaction(async (tx) => {
    await tx.userPicture.upsert({
      where: { userId },
      update: {
        ...(photoURL !== undefined ? { photoSet: true } : {}),
        ...(displayName !== undefined ? { nameSet: true } : {}),
      },
      create: {
        userId,
        photoSet: photoURL !== undefined,
        basePhotoURL: existingUser.photoURL ?? photoURL ?? "",
        nameSet: displayName !== undefined,
        displayName: existingUser.displayName ?? displayName ?? "",
      },
    });

    return tx.user.update({
      where: { id: userId },
      data: {
        ...(photoURL !== undefined ? { photoURL } : {}),
        ...(displayName !== undefined ? { displayName } : {}),
      },
      select: { id: true, displayName: true, photoURL: true },
    });
  });
}
