"use client";

import { getAgentAvatarDataUri, getAvatarInitials, hasCustomAvatar } from "@/lib/avatar";
import { cn } from "@/utils/undoActions/helperFuncs";
import { useMemo, useState } from "react";

interface UserAvatarProps {
  alt?: string;
  className?: string;
  compactOnMobile?: boolean;
  fallbackClassName?: string;
  imageClassName?: string;
  name?: string | null;
  photoURL?: string | null;
  size?: number;
  title?: string;
  /** Set for agents: generates a distinct robot-face avatar when there is no custom photo. HTPR-6034. */
  agentId?: string | null;
}

const UserAvatar: React.FC<UserAvatarProps> = ({
  alt,
  className,
  compactOnMobile = false,
  fallbackClassName,
  imageClassName,
  name,
  photoURL,
  size = 20,
  title,
  agentId,
}) => {
  const [failedPhotoURL, setFailedPhotoURL] = useState<string | null>(null);
  const accessibleName = alt ?? (name ? `${name} avatar` : "Profile avatar");
  const sharedClassName = cn(
    "shrink-0 overflow-hidden rounded-full",
    compactOnMobile && "h-4 w-4 sm:h-8 sm:w-8",
    className,
  );
  const generatedAvatarUri = useMemo(
    () => (agentId ? getAgentAvatarDataUri(agentId) : null),
    [agentId],
  );

  if (hasCustomAvatar(photoURL) && failedPhotoURL !== photoURL) {
    return (
      <img
        alt={accessibleName}
        className={cn(sharedClassName, "object-cover", imageClassName)}
        decoding="async"
        height={size}
        onError={() => setFailedPhotoURL(photoURL)}
        src={photoURL}
        title={title}
        width={size}
      />
    );
  }

  if (generatedAvatarUri) {
    return (
      <img
        alt={accessibleName}
        className={cn(sharedClassName, imageClassName)}
        height={size}
        src={generatedAvatarUri}
        title={title}
        width={size}
      />
    );
  }

  return (
    <span
      aria-hidden={accessibleName === "" ? true : undefined}
      aria-label={accessibleName || undefined}
      className={cn(
        sharedClassName,
        "inline-flex items-center justify-center bg-active-modal-element font-semibold leading-none text-white-black",
        compactOnMobile
          ? "text-[8px] sm:text-meta"
          : size <= 16
            ? "text-[8px]"
            : size <= 24
              ? "text-micro"
              : size <= 32
                ? "text-meta"
                : "text-emphasis",
        fallbackClassName,
      )}
      role={accessibleName ? "img" : undefined}
      style={compactOnMobile ? undefined : { height: size, width: size }}
      title={title}
    >
      {getAvatarInitials(name)}
    </span>
  );
};

export default UserAvatar;
