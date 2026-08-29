"use client";

import { getAvatarInitials, hasCustomAvatar } from "@/lib/avatar";
import { cn } from "@/utils/undoActions/helperFuncs";
import { useState } from "react";

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
}) => {
  const [failedPhotoURL, setFailedPhotoURL] = useState<string | null>(null);
  const accessibleName = alt ?? (name ? `${name} avatar` : "Profile avatar");
  const sharedClassName = cn(
    "shrink-0 overflow-hidden rounded-full",
    compactOnMobile && "h-4 w-4 sm:h-8 sm:w-8",
    className,
  );

  if (hasCustomAvatar(photoURL) && failedPhotoURL !== photoURL) {
    return (
      <img
        alt={accessibleName}
        className={cn(sharedClassName, "object-cover", imageClassName)}
        decoding="async"
        height={size}
        loading="lazy"
        onError={() => setFailedPhotoURL(photoURL)}
        src={photoURL}
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
