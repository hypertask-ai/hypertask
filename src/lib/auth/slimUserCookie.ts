const TARGET_ENCODED_COOKIE_LENGTH = 3_800;
const MAX_ENCODED_COOKIE_LENGTH = 3_900;

const LARGE_USER_SETTING_KEYS = new Set([
  "notificationMatrix",
  "productTours",
  "emojiFrequency",
  "snippets",
  "aiModelPreferences",
  "calendarViews",
]);

type CookieRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is CookieRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const encodedJsonLength = (value: unknown): number => {
  try {
    return encodeURIComponent(JSON.stringify(value)).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

const minimalIdentity = (userData: CookieRecord): CookieRecord => ({
  id: userData.id,
  displayName: userData.displayName,
  email: userData.email,
  uid: userData.uid,
  photoURL: userData.photoURL,
});

const trimStringFieldToFit = (
  identity: CookieRecord,
  key: "displayName" | "email",
): void => {
  const value = identity[key];
  if (typeof value !== "string" || value.length <= 1) return;

  const characters = Array.from(value);
  let low = 1;
  let high = characters.length;
  let fittingLength = 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    identity[key] = characters.slice(0, middle).join("");

    if (encodedJsonLength(identity) <= TARGET_ENCODED_COOKIE_LENGTH) {
      fittingLength = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  identity[key] = characters.slice(0, fittingLength).join("");
};

const fitMinimalIdentity = (userData: CookieRecord): CookieRecord => {
  const identity = minimalIdentity(userData);
  if (encodedJsonLength(identity) <= TARGET_ENCODED_COOKIE_LENGTH) {
    return identity;
  }

  if (typeof identity.photoURL === "string") identity.photoURL = "";
  if (typeof identity.uid === "string") identity.uid = "";
  trimStringFieldToFit(identity, "displayName");
  trimStringFieldToFit(identity, "email");

  if (encodedJsonLength(identity) > MAX_ENCODED_COOKIE_LENGTH) {
    throw new RangeError("Minimal user identity exceeds the cookie size limit");
  }

  return identity;
};

/**
 * Removes unbounded preferences from the legacy user cookie and guarantees the
 * URL-encoded JSON remains safely below browser cookie limits.
 */
export const slimUserForCookie = (userData: unknown): CookieRecord => {
  const user = isRecord(userData) ? userData : {};
  const candidate: CookieRecord = { ...user };

  if (isRecord(user.UserSetting)) {
    const settings = Object.fromEntries(
      Object.entries(user.UserSetting).filter(
        ([key]) => !LARGE_USER_SETTING_KEYS.has(key),
      ),
    );
    candidate.UserSetting = settings;

    if (encodedJsonLength(candidate) > TARGET_ENCODED_COOKIE_LENGTH) {
      const remainingSettings = Object.entries(settings).sort(
        ([leftKey, leftValue], [rightKey, rightValue]) =>
          encodedJsonLength({ [rightKey]: rightValue }) -
          encodedJsonLength({ [leftKey]: leftValue }),
      );

      for (const [key] of remainingSettings) {
        delete settings[key];
        if (encodedJsonLength(candidate) <= TARGET_ENCODED_COOKIE_LENGTH) {
          return candidate;
        }
      }
    }
  }

  if (encodedJsonLength(candidate) <= TARGET_ENCODED_COOKIE_LENGTH) {
    return candidate;
  }

  return fitMinimalIdentity(user);
};
