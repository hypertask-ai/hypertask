import { FEATURE_FLAG_OWNER_USER_ID, FEATURE_FLAG_QA_USER_ID } from "@/lib/auth/ownerOrQaIds";

export { FEATURE_FLAG_OWNER_USER_ID, FEATURE_FLAG_QA_USER_ID };
export const FEATURE_FLAG_OWNER = {
  userId: FEATURE_FLAG_OWNER_USER_ID,
  email: "valentin.yeo@gmail.com",
} as const;
export const FEATURE_FLAG_QA_USER = {
  userId: FEATURE_FLAG_QA_USER_ID,
  email: "valentin@hypertask.ai",
} as const;

export function isOwnerOrQaUser(user: { id: number; email?: string } | null | undefined): boolean {
  return [FEATURE_FLAG_OWNER, FEATURE_FLAG_QA_USER].some(
    (identity) => user?.id === identity.userId && user.email?.trim().toLowerCase() === identity.email,
  );
}
