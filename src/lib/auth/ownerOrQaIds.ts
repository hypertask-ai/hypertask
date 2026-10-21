export const FEATURE_FLAG_OWNER_USER_ID = 6;
export const FEATURE_FLAG_QA_USER_ID = 985;

export function hasOwnerOrQaUserId(user: { id?: number } | null | undefined): boolean {
  return user?.id === FEATURE_FLAG_OWNER_USER_ID || user?.id === FEATURE_FLAG_QA_USER_ID;
}
