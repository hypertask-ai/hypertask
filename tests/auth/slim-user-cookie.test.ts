import assert from "node:assert/strict";

import { slimUserForCookie } from "../../src/lib/auth/slimUserCookie";
import { isValidUser } from "../../src/utils/edgeHelpers";

const encodedLength = (value: unknown) =>
  encodeURIComponent(JSON.stringify(value)).length;

const identity = {
  id: 6,
  displayName: "Valentin Yeo",
  email: "valentin@hypertask.ai",
  uid: "firebase-uid-6",
  photoURL: "https://example.com/avatar.png",
  stripe_customer_id: "cus_123",
  userPicture: {
    id: "picture-6",
    basePhotoURL: "https://example.com/base-avatar.png",
    photoSet: true,
  },
};

const bloatedUser = {
  ...identity,
  joinedAt: "2023-01-01T00:00:00.000Z",
  UserSetting: {
    id: "settings-6",
    userId: 6,
    onboardingTourStatus: true,
    onboardingTutorialStatus: true,
    isVerified: true,
    trialStatus: false,
    notification: true,
    notificationPreference: "direct",
    theme: "graphite",
    notificationMatrix: { history: "n".repeat(6_000) },
    productTours: { history: "p".repeat(6_000) },
    emojiFrequency: { history: "e".repeat(6_000) },
    snippets: [{ id: "snippet-1", content: "s".repeat(6_000) }],
    aiModelPreferences: { history: "a".repeat(6_000) },
    calendarViews: { history: "c".repeat(6_000) },
  },
};

assert.ok(encodedLength(bloatedUser.UserSetting) > 5_000);

const slimBloatedUser = slimUserForCookie(bloatedUser);
assert.ok(
  encodedLength(slimBloatedUser) < 3_900,
  "bloated users must fit safely below the browser cookie limit",
);
assert.equal(isValidUser(JSON.stringify(slimBloatedUser)).isValid, true);

for (const [key, value] of Object.entries(identity)) {
  assert.deepEqual(slimBloatedUser[key], value, `${key} must survive slimming`);
}

assert.deepEqual(slimBloatedUser.UserSetting, {
  id: "settings-6",
  userId: 6,
  onboardingTourStatus: true,
  onboardingTutorialStatus: true,
  isVerified: true,
  trialStatus: false,
  notification: true,
  notificationPreference: "direct",
  theme: "graphite",
});

const normalUser = {
  ...identity,
  accountId: "account-6",
  UserSettingId: "settings-6",
  UserSetting: {
    id: "settings-6",
    userId: 6,
    notification: true,
    notificationPreference: "all",
    commentsStacked: true,
    shareReadReceipts: false,
    scrollSetting: "Bottom",
    displayAvatar: "Hidden",
    onboardingTourStatus: true,
    onboardingTutorialStatus: false,
    trialStatus: false,
    isVerified: true,
    muteAnnouncements: false,
    playGifs: true,
    dictationLanguage: "en",
    inboxAdvanceOnSend: true,
    notificationMatrix: {},
    productTours: {},
    emojiFrequency: null,
    snippets: [],
    aiModelPreferences: null,
    calendarViews: null,
  },
};

const slimNormalUser = slimUserForCookie(normalUser);
const {
  notificationMatrix: _notificationMatrix,
  productTours: _productTours,
  emojiFrequency: _emojiFrequency,
  snippets: _snippets,
  aiModelPreferences: _aiModelPreferences,
  calendarViews: _calendarViews,
  ...importantSettings
} = normalUser.UserSetting;

assert.deepEqual(slimNormalUser, {
  ...normalUser,
  UserSetting: importantSettings,
});

const futureBloatedUser = {
  ...normalUser,
  UserSetting: {
    ...normalUser.UserSetting,
    futureLargeSetting: "x".repeat(8_000),
    futureSmallSetting: "keep-if-it-fits",
  },
};
const slimFutureBloatedUser = slimUserForCookie(futureBloatedUser);

assert.ok(encodedLength(slimFutureBloatedUser) < 3_900);
assert.equal(
  (slimFutureBloatedUser.UserSetting as Record<string, unknown>)
    .futureLargeSetting,
  undefined,
);
assert.equal(
  (slimFutureBloatedUser.UserSetting as Record<string, unknown>)
    .futureSmallSetting,
  "keep-if-it-fits",
);

const slimTopLevelBloat = slimUserForCookie({
  ...normalUser,
  largeIncludedRelation: "r".repeat(8_000),
});
assert.deepEqual(slimTopLevelBloat, {
  id: identity.id,
  displayName: identity.displayName,
  email: identity.email,
  uid: identity.uid,
  photoURL: identity.photoURL,
});

const slimExtremeIdentity = slimUserForCookie({
  ...identity,
  displayName: "d".repeat(5_000),
  email: "e".repeat(5_000),
  uid: "u".repeat(5_000),
  photoURL: "p".repeat(5_000),
});
assert.ok(encodedLength(slimExtremeIdentity) < 3_900);
assert.equal(isValidUser(JSON.stringify(slimExtremeIdentity)).isValid, true);
assert.deepEqual(Object.keys(slimExtremeIdentity), [
  "id",
  "displayName",
  "email",
  "uid",
  "photoURL",
]);

console.log("slim-user-cookie.test.ts: all assertions passed");
