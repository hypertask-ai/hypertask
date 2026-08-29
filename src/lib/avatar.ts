import { generalConfig } from "@/lib/configs/general.config";
import { collectGraphemes } from "unicode-segmenter/grapheme";

const stripUrlSuffix = (value: string) => value.split(/[?#]/, 1)[0];

const DEFAULT_AVATAR_URLS = new Set([
  generalConfig.defaultPhotoURL,
  "https://duv2gcpdgd578.cloudfront.net/tasks/attachments/1757584422625image.png",
]);

const uppercaseGrapheme = (value: string) =>
  collectGraphemes(value.toUpperCase())[0] ?? "";

const uppercaseInitials = (values: string[]) =>
  values.slice(0, 2).map(uppercaseGrapheme).join("");

export function hasCustomAvatar(photoURL?: string | null): photoURL is string {
  const normalized = photoURL?.trim();
  if (!normalized) return false;

  return !DEFAULT_AVATAR_URLS.has(stripUrlSuffix(normalized));
}

export function getAvatarInitials(name?: string | null): string {
  const words = (name ?? "").trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return "?";

  const firstWord = collectGraphemes(words[0]);
  if (words.length === 1) {
    return uppercaseInitials(firstWord);
  }

  const lastWord = collectGraphemes(words[words.length - 1]);
  return uppercaseInitials([firstWord[0] ?? "", lastWord[0] ?? ""]);
}
